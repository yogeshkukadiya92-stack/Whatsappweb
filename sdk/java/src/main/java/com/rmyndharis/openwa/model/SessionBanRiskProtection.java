package com.rmyndharis.openwa.model;

public record SessionBanRiskProtection(boolean enabled, int threshold, boolean autoStopped, String stoppedAt, Integer lastScore) {}
