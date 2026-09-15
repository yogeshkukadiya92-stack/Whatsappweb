import { SessionSchedulerService, SessionScheduleConfig } from './session-scheduler.service';
import { Repository } from 'typeorm';
import { Session, SessionStatus } from './entities/session.entity';
import { SessionService } from './session.service';

describe('SessionSchedulerService', () => {
  let service: SessionSchedulerService;
  let mockSessionRepo: Partial<Repository<Session>>;
  let mockSessionService: Partial<SessionService>;

  beforeEach(() => {
    mockSessionRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    mockSessionService = {
      isActive: jest.fn().mockReturnValue(false),
      start: jest.fn().mockResolvedValue({} as any),
      stop: jest.fn().mockResolvedValue({} as any),
    };

    service = new SessionSchedulerService(
      mockSessionRepo as Repository<Session>,
      mockSessionService as SessionService,
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
  });
});
