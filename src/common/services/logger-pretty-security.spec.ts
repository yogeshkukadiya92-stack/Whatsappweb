import { LoggerService, LogFormat, LogLevel } from './logger.service';

describe('human-readable operational logging', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    LoggerService.setLogFormat(LogFormat.PRETTY);
    LoggerService.setLogLevel(LogLevel.VERBOSE);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...saved };
    LoggerService.setLogFormat(null);
    LoggerService.setLogLevel(LogLevel.INFO);
  });
  it('keeps context, trace and typed metadata readable while redacting credentials', () => {
    process.env.NO_COLOR = '1';
    const logger = new LoggerService();
    logger.error('Provider refused checkout', 'trace fixture', 'Billing');
    expect(console.error).toHaveBeenLastCalledWith(
      expect.stringContaining('[Billing] Provider refused checkout\ntrace fixture'),
    );
    logger.verbose('Recovery sweep', {
      count: 2,
      ready: true,
      nested: { token: 'private-fixture', items: [1, null] },
      label: 'complete',
    });
    expect(console.log).toHaveBeenLastCalledWith(
      expect.stringContaining('count=2 ready=true nested={"token":"[REDACTED]","items":[1,null]} label=complete'),
    );
    expect(JSON.stringify(jest.mocked(console.log).mock.calls)).not.toContain('private-fixture');
  });
  it('honors forced color and the explicit output format without a TTY', () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = '1';
    const logger = new LoggerService();
    logger.log('Ready');
    expect(console.log).toHaveBeenLastCalledWith(expect.stringContaining('\x1b['));
    LoggerService.setLogFormat(null);
    process.env.LOG_FORMAT = ' JSON ';
    logger.log('Structured');
    expect(JSON.parse(jest.mocked(console.log).mock.calls.at(-1)![0] as string)).toMatchObject({
      message: 'Structured',
      level: 'info',
    });
  });
  it('falls back to structured production logs and readable development logs for unknown format settings', () => {
    const logger = new LoggerService();
    LoggerService.setLogFormat(null);
    delete process.env.LOG_FORMAT;
    process.env.NODE_ENV = 'production';
    logger.log('Production');
    expect(JSON.parse(jest.mocked(console.log).mock.calls.at(-1)![0] as string)).toMatchObject({
      message: 'Production',
    });
    process.env.LOG_FORMAT = 'unknown';
    process.env.NODE_ENV = 'development';
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    logger.log('Development');
    expect(console.log).toHaveBeenLastCalledWith(expect.stringContaining('[Application] Development'));
  });
});
