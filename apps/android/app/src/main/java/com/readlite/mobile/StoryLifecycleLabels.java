package com.readlite.mobile;

/** Publication progress is independent from moderation and the reader's own completion. */
public final class StoryLifecycleLabels {
    private StoryLifecycleLabels() { }
    public static String label(String status) {
        if ("completed".equals(status)) return "Hoàn thành";
        if ("paused".equals(status)) return "Tạm ngưng";
        return "Đang ra";
    }
}
