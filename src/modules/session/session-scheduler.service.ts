import { Injectable, OnModuleInit, OnModuleDestroy, Optional, forwardRef, Inject } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session, SessionStatus } from './entities/session.entity';
import { SessionService } from './session.service';
import { StatsService } from '../stats/stats.service';
import { createLogger } from '../../common/services/logger.service';
import { ShutdownService } from '../../common/services/shutdown.service';

/** Check interval: 30 seconds for precise transitions */
export const SCHEDULER_INTERVAL_MS = 30_000;

export interface SessionScheduleConfig {
  enabled: boolean;
  startTime: string | null; // "HH:mm"
  endTime: string | null;   // "HH:mm"
  days: number[] | null;     // [0,1,2,3,4,5,6] (0=Sun, 1=Mon, ..., 6=Sat)
  timezone: string | null;   // IANA timezone e.g. "Asia/Kolkata"
}

@Injectable()
export class SessionSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = createLogger('SessionSchedulerService');
  private timer: NodeJS.Timeout | null = null;
  private isTickRunning = false;

  constructor(
    @InjectRepository(Session, 'data')
    private readonly sessionRepository: Repository<Session>,
    private readonly sessionService: SessionService,
    @Optional()
    @Inject(forwardRef(() => StatsService))
    private readonly statsService?: StatsService,
    @Optional()
    private readonly shutdownService?: ShutdownService,
  ) {}

  onModuleInit(): void {
    this.start();
  }

  onModuleDestroy(): void {
    this.stop();
  }

  start(intervalMs = SCHEDULER_INTERVAL_MS): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
    this.timer.unref();
    this.logger.log('Session working-hours and ban risk scheduler started', { intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Evaluates whether current wall-clock time is inside the scheduled working window.
   */
  isInsideSchedule(schedule: SessionScheduleConfig, now = new Date()): boolean {
    if (!schedule.enabled || !schedule.startTime || !schedule.endTime) {
      return true; // Not actively scheduled, default to unconstrained
    }

    try {
      const tz = schedule.timezone || 'UTC';

      // Get current hour and minute in target timezone
      const timeFormatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const [hStr, mStr] = timeFormatter.format(now).split(':');
      const currentMinutes = parseInt(hStr, 10) * 60 + parseInt(mStr, 10);

      // Get day of week (0=Sun, 1=Mon, ..., 6=Sat) in target timezone
      const dayFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        weekday: 'short',
      });
      const weekdayStr = dayFormatter.format(now); // "Sun", "Mon", "Tue", ...
      const weekdayMap: Record<string, number> = {
        Sun: 0,
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
      };
      const currentDay = weekdayMap[weekdayStr] ?? now.getDay();

      // If active days are specified, check if today is included
      if (Array.isArray(schedule.days) && schedule.days.length > 0) {
        if (!schedule.days.includes(currentDay)) {
          return false; // Not scheduled to run on this day
        }
      }

      const [startH, startM] = schedule.startTime.split(':').map(Number);
      const [endH, endM] = schedule.endTime.split(':').map(Number);

      const startMinutes = (startH || 0) * 60 + (startM || 0);
      const endMinutes = (endH || 0) * 60 + (endM || 0);

      if (startMinutes <= endMinutes) {
        // Standard window, e.g. 09:00 to 18:00
        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
      } else {
        // Overnight window, e.g. 22:00 to 06:00
        return currentMinutes >= startMinutes || currentMinutes < endMinutes;
      }
    } catch (err) {
      this.logger.warn('Failed to parse schedule time window', { error: err instanceof Error ? err.message : String(err) });
      return true;
    }
  }

  async tick(): Promise<void> {
    if (this.isTickRunning) return;
    if (this.shutdownService?.isShuttingDown()) return;

    this.isTickRunning = true;
    try {
      const sessions = await this.sessionRepository.find();
      const now = new Date();

      for (const session of sessions) {
        const config = (session.config ?? {}) as Record<string, unknown>;
        const isEngineActive = this.sessionService.isActive(session.id);
        const isConnectedOrPending = [
          SessionStatus.READY,
          SessionStatus.INITIALIZING,
          SessionStatus.QR_READY,
          SessionStatus.AUTHENTICATING,
        ].includes(session.status);

        // -------------------------------------------------------------
        // 1. BAN RISK AUTO-STOP & AUTO-START PROTECTION
        // -------------------------------------------------------------
        let banRiskBlocked = false;
        if (config.banRiskAutoStopEnabled === true && this.statsService) {
          try {
            const stats = await this.statsService.getSessionStats(session.id);
            const banRiskScore = stats.banRisk?.score ?? 0;
            const threshold =
              typeof config.banRiskThreshold === 'number' && Number.isFinite(config.banRiskThreshold)
                ? config.banRiskThreshold
                : 80;

            if (banRiskScore >= threshold) {
              banRiskBlocked = true;
              if (isEngineActive || isConnectedOrPending) {
                // Risk reached/exceeded threshold! Stop session to protect account
                this.logger.warn(`Ban risk threshold exceeded (${banRiskScore} >= ${threshold}) for session ${session.name}. Auto-stopping session.`, {
                  sessionId: session.id,
                  banRiskScore,
                  threshold,
                });

                // Mark session config as auto-stopped by ban risk
                await this.sessionRepository.update(session.id, {
                  config: {
                    ...config,
                    autoStoppedByBanRisk: true,
                    banRiskStoppedAt: new Date().toISOString(),
                    banRiskLastScore: banRiskScore,
                  } as any,
                });

                try {
                  await this.sessionService.stop(session.id);
                } catch (err) {
                  this.logger.warn(`Failed auto-stop on high ban risk for session ${session.name}`, {
                    sessionId: session.id,
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }
            } else if (config.autoStoppedByBanRisk === true) {
              // Ban risk score has cooled down below threshold!
              this.logger.log(`Ban risk score cooled down (${banRiskScore} < ${threshold}) for session ${session.name}. Clearing auto-stopped flag.`, {
                sessionId: session.id,
                banRiskScore,
                threshold,
              });

              const updatedConfig = { ...config };
              delete updatedConfig.autoStoppedByBanRisk;
              delete updatedConfig.banRiskStoppedAt;
              delete updatedConfig.banRiskLastScore;

              await this.sessionRepository.update(session.id, {
                config: updatedConfig as any,
              });

              // If working-hours schedule allows running (or schedule is disabled), auto-start!
              let canResumeSchedule = true;
              if (config.scheduleEnabled === true) {
                const schedule: SessionScheduleConfig = {
                  enabled: true,
                  startTime: typeof config.scheduleStartTime === 'string' ? config.scheduleStartTime : null,
                  endTime: typeof config.scheduleEndTime === 'string' ? config.scheduleEndTime : null,
                  days: Array.isArray(config.scheduleDays) ? (config.scheduleDays as number[]) : null,
                  timezone: typeof config.scheduleTimezone === 'string' ? config.scheduleTimezone : null,
                };
                canResumeSchedule = this.isInsideSchedule(schedule, now);
              }

              if (canResumeSchedule && !isEngineActive && session.status !== SessionStatus.READY && session.status !== SessionStatus.INITIALIZING) {
                this.logger.log(`Auto-starting session ${session.name} after ban risk cooled down.`, {
                  sessionId: session.id,
                  banRiskScore,
                  threshold,
                });
                try {
                  await this.sessionService.start(session.id);
                } catch (err) {
                  this.logger.warn(`Failed auto-start after ban risk cooldown for session ${session.name}`, {
                    sessionId: session.id,
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }
            }
          } catch (err) {
            this.logger.warn(`Error evaluating ban risk for session ${session.name}`, {
              sessionId: session.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // If currently blocked by high ban risk, skip regular schedule start
        if (banRiskBlocked) {
          continue;
        }

        // -------------------------------------------------------------
        // 2. WORKING HOURS SCHEDULE AUTO-START / AUTO-STOP
        // -------------------------------------------------------------
        if (config.scheduleEnabled !== true) continue;

        const schedule: SessionScheduleConfig = {
          enabled: true,
          startTime: typeof config.scheduleStartTime === 'string' ? config.scheduleStartTime : null,
          endTime: typeof config.scheduleEndTime === 'string' ? config.scheduleEndTime : null,
          days: Array.isArray(config.scheduleDays) ? (config.scheduleDays as number[]) : null,
          timezone: typeof config.scheduleTimezone === 'string' ? config.scheduleTimezone : null,
        };

        const shouldBeRunning = this.isInsideSchedule(schedule, now);

        if (shouldBeRunning && !isEngineActive && session.status !== SessionStatus.READY && session.status !== SessionStatus.INITIALIZING) {
          // Inside scheduled window, but session is stopped/disconnected -> Auto-start
          this.logger.log(`Scheduled auto-start triggered for session ${session.name}`, {
            sessionId: session.id,
            startTime: schedule.startTime,
            endTime: schedule.endTime,
          });
          try {
            await this.sessionService.start(session.id);
          } catch (err) {
            this.logger.warn(`Failed scheduled start for session ${session.name}`, {
              sessionId: session.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        } else if (!shouldBeRunning && (isEngineActive || isConnectedOrPending)) {
          // Outside scheduled window, but session is currently running -> Auto-stop
          this.logger.log(`Scheduled auto-stop triggered for session ${session.name}`, {
            sessionId: session.id,
            startTime: schedule.startTime,
            endTime: schedule.endTime,
          });
          try {
            await this.sessionService.stop(session.id);
          } catch (err) {
            this.logger.warn(`Failed scheduled stop for session ${session.name}`, {
              sessionId: session.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    } catch (err) {
      const trace = err instanceof Error ? err.stack : undefined;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Error in SessionSchedulerService tick: ${msg}`, trace);
    } finally {
      this.isTickRunning = false;
    }
  }
}
