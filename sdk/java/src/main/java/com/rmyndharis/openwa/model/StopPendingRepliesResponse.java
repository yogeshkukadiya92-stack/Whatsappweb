package com.rmyndharis.openwa.model;

/** Outcome of an emergency stop of pending replies (OPERATOR). */
public record StopPendingRepliesResponse(boolean success, String sessionId, int cancelledJobs, int cancelledBatches, int cancelledMessages, String message) {}
