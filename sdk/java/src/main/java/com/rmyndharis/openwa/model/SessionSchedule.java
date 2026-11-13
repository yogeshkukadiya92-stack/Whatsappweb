package com.rmyndharis.openwa.model;

public record SessionSchedule(boolean enabled, String startTime, String endTime, java.util.List<Integer> days, String timezone) {}
