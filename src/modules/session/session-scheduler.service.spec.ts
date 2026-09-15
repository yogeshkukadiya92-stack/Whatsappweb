import { SessionSchedulerService, SessionScheduleConfig } from './session-scheduler.service';
import { Repository } from 'typeorm';
import { Session, SessionStatus } from './entities/session.entity';
import { SessionService } from './session.service';
import { StatsService } from '../stats/stats.service';

describe('SessionSchedulerService', () => {
  let service: SessionSchedulerService;
  let mockSessionRepo: Partial<Repository<Session>>;
  let mockSessionService: Partial<SessionService>;
  let mockStatsService: Partial<StatsService>;

  beforeEach(() => {
    mockSessionRepo = {
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({} as any),
    };
    mockSessionService = {
      isActive: jest.fn().mockReturnValue(false),
      start: jest.fn().mockResolvedValue({} as any),
      stop: jest.fn().mockResolvedValue({} as any),
    };
    mockStatsService = {
      getSessionStats: jest.fn().mockResolvedValue({ banRisk: { score: 10, level: 'low', reasons: [] } } as any),
    };

    service = new SessionSchedulerService(
      mockSessionRepo as Repository<Session>,
      mockSessionService as SessionService,
      mockStatsService as StatsService,
    );
  });

  afterEach(() => {
    service.stop();
  });

  describe('isInsideSchedule', () => {
    it('returns true if schedule is not enabled', () => {
      const schedule: SessionScheduleConfig = {
        enabled: false,
        startTime: '09:00',
        endTime: '18:00',
        days: [1, 2, 3, 4, 5],
        timezone: 'UTC',
      };
      expect(service.isInsideSchedule(schedule)).toBe(true);
    });

    it('returns true when current time is strictly inside standard working hours', () => {
      const schedule: SessionScheduleConfig = {
        enabled: true,
        startTime: '09:00',
        endTime: '18:00',
        days: [1, 2, 3, 4, 5],
        timezone: 'UTC',
      };
      // Wednesday 2026-09-16 12:00 UTC (day 3)
      const now = new Date('2026-09-16T12:00:00Z');
      expect(service.isInsideSchedule(schedule, now)).toBe(true);
    });

    it('returns false when current time is outside standard working hours', () => {
      const schedule: SessionScheduleConfig = {
        enabled: true,
        startTime: '09:00',
        endTime: '18:00',
        days: [1, 2, 3, 4, 5],
        timezone: 'UTC',
      };
      // Wednesday 2026-09-16 20:00 UTC (past 18:00)
      const now = new Date('2026-09-16T20:00:00Z');
      expect(service.isInsideSchedule(schedule, now)).toBe(false);
    });

    it('returns false when today is not an active day', () => {
      const schedule: SessionScheduleConfig = {
        enabled: true,
        startTime: '09:00',
        endTime: '18:00',
        days: [1, 2, 3, 4, 5], // Mon-Fri
        timezone: 'UTC',
      };
      // Sunday 2026-09-13 12:00 UTC (day 0)
      const sunday = new Date('2026-09-13T12:00:00Z');
      expect(service.isInsideSchedule(schedule, sunday)).toBe(false);
    });

    it('handles overnight working hours (e.g. 22:00 to 06:00)', () => {
      const schedule: SessionScheduleConfig = {
        enabled: true,
        startTime: '22:00',
        endTime: '06:00',
        days: null,
        timezone: 'UTC',
      };
      // 23:00 -> inside
      expect(service.isInsideSchedule(schedule, new Date('2026-09-16T23:00:00Z'))).toBe(true);
      // 03:00 -> inside
      expect(service.isInsideSchedule(schedule, new Date('2026-09-16T03:00:00Z'))).toBe(true);
      // 12:00 -> outside
      expect(service.isInsideSchedule(schedule, new Date('2026-09-16T12:00:00Z'))).toBe(false);
    });
  });

  describe('tick execution', () => {
    it('triggers start for scheduled session when inside window and disconnected', async () => {
      const session = {
        id: 'sess-1',
        name: 'test-session',
        status: SessionStatus.DISCONNECTED,
        config: {
          scheduleEnabled: true,
          scheduleStartTime: '00:00',
          scheduleEndTime: '23:59',
          scheduleDays: [0, 1, 2, 3, 4, 5, 6],
        },
      } as Session;

      (mockSessionRepo.find as jest.Mock).mockResolvedValue([session]);
      (mockSessionService.isActive as jest.Mock).mockReturnValue(false);

      await service.tick();

      expect(mockSessionService.start).toHaveBeenCalledWith('sess-1');
      expect(mockSessionService.stop).not.toHaveBeenCalled();
    });

    it('triggers stop for scheduled session when outside window and currently ready', async () => {
      const session = {
        id: 'sess-2',
        name: 'test-session-2',
        status: SessionStatus.READY,
        config: {
          scheduleEnabled: true,
          scheduleStartTime: '01:00',
          scheduleEndTime: '02:00',
          scheduleDays: [1], // Monday only
          scheduleTimezone: 'UTC',
        },
      } as Session;

      // Make tick evaluate as outside window
      (mockSessionRepo.find as jest.Mock).mockResolvedValue([session]);
      (mockSessionService.isActive as jest.Mock).mockReturnValue(true);

      // Force an outside time
      const origNow = Date.now;
      try {
        Date.now = () => new Date('2026-09-13T12:00:00Z').getTime(); // Sunday noon
        await service.tick();
      } finally {
        Date.now = origNow;
      }

      expect(mockSessionService.stop).toHaveBeenCalledWith('sess-2');
    });

    it('triggers auto-stop when banRiskAutoStopEnabled is true and ban risk score >= threshold', async () => {
      const session = {
        id: 'sess-ban-high',
        name: 'risky-session',
        status: SessionStatus.READY,
        config: {
          banRiskAutoStopEnabled: true,
          banRiskThreshold: 80,
        },
      } as Session;

      (mockSessionRepo.find as jest.Mock).mockResolvedValue([session]);
      (mockSessionService.isActive as jest.Mock).mockReturnValue(true);
      (mockStatsService.getSessionStats as jest.Mock).mockResolvedValue({
        banRisk: { score: 85, level: 'critical', reasons: ['High failure rate'] },
      });

      await service.tick();

      expect(mockSessionService.stop).toHaveBeenCalledWith('sess-ban-high');
      expect(mockSessionRepo.update).toHaveBeenCalledWith(
        'sess-ban-high',
        expect.objectContaining({
          config: expect.objectContaining({
            autoStoppedByBanRisk: true,
            banRiskLastScore: 85,
          }),
        }),
      );
    });

    it('triggers auto-start when session was auto-stopped by ban risk and score cools down below threshold', async () => {
      const session = {
        id: 'sess-ban-cool',
        name: 'cooled-session',
        status: SessionStatus.STOPPED,
        config: {
          banRiskAutoStopEnabled: true,
          banRiskThreshold: 80,
          autoStoppedByBanRisk: true,
          banRiskLastScore: 85,
        },
      } as Session;

      (mockSessionRepo.find as jest.Mock).mockResolvedValue([session]);
      (mockSessionService.isActive as jest.Mock).mockReturnValue(false);
      (mockStatsService.getSessionStats as jest.Mock).mockResolvedValue({
        banRisk: { score: 40, level: 'medium', reasons: [] },
      });

      await service.tick();

      expect(mockSessionService.start).toHaveBeenCalledWith('sess-ban-cool');
      expect(mockSessionRepo.update).toHaveBeenCalledWith(
        'sess-ban-cool',
        expect.objectContaining({
          config: expect.not.objectContaining({
            autoStoppedByBanRisk: true,
          }),
        }),
      );
    });

    it('does not auto-start if working hours schedule forbids it even after ban risk cools down', async () => {
      const session = {
        id: 'sess-ban-cool-schedule-off',
        name: 'cooled-session-offhours',
        status: SessionStatus.STOPPED,
        config: {
          banRiskAutoStopEnabled: true,
          banRiskThreshold: 80,
          autoStoppedByBanRisk: true,
          scheduleEnabled: true,
          scheduleStartTime: '01:00',
          scheduleEndTime: '02:00',
          scheduleDays: [1], // Monday only
          scheduleTimezone: 'UTC',
        },
      } as Session;

      (mockSessionRepo.find as jest.Mock).mockResolvedValue([session]);
      (mockSessionService.isActive as jest.Mock).mockReturnValue(false);
      (mockStatsService.getSessionStats as jest.Mock).mockResolvedValue({
        banRisk: { score: 25, level: 'low', reasons: [] },
      });

      const origNow = Date.now;
      try {
        Date.now = () => new Date('2026-09-13T12:00:00Z').getTime(); // Sunday noon
        await service.tick();
      } finally {
        Date.now = origNow;
      }

      // Schedule forbids running on Sunday noon -> should clear the ban risk flag, but NOT start
      expect(mockSessionService.start).not.toHaveBeenCalled();
      expect(mockSessionRepo.update).toHaveBeenCalled();
    });
  });
});
