import { BadRequestException, ConflictException } from '@nestjs/common';

export interface LoginIdentifiers {
  username?: string;
  phone?: string;
}

export function normalizeLoginIdentifiers(values: LoginIdentifiers): LoginIdentifiers {
  if (
    (values.username != null && typeof values.username !== 'string') ||
    (values.phone != null && typeof values.phone !== 'string')
  ) {
    throw new BadRequestException('Username and mobile number must be text');
  }
  const username = values.username?.trim().toLowerCase() || undefined;
  const rawPhone = values.phone?.trim() || undefined;
  if (username && !/^[a-z][a-z0-9_.-]{2,99}$/.test(username)) {
    throw new BadRequestException(
      'Username must be 3–100 characters, start with a letter and contain only letters, numbers, dots, underscores or hyphens',
    );
  }
  if (rawPhone && !/^\+?[\d\s().-]+$/.test(rawPhone)) {
    throw new BadRequestException('Enter a mobile number with country code, for example +919876543210');
  }
  const digits = rawPhone?.replace(/\D/g, '');
  if (rawPhone && (!digits || !/^[1-9]\d{7,14}$/.test(digits))) {
    throw new BadRequestException('Enter a mobile number with country code, for example +919876543210');
  }
  return { ...(username ? { username } : {}), ...(digits ? { phone: `+${digits}` } : {}) };
}

export function rethrowRegistrationError(error: unknown): never {
  if (['23505', 'SQLITE_CONSTRAINT_UNIQUE'].includes((error as { code?: string })?.code ?? '')) {
    throw new ConflictException('Email, username or mobile number is already in use');
  }
  throw error;
}
