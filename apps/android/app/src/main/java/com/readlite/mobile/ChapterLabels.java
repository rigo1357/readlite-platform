package com.readlite.mobile;

import android.content.Context;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class ChapterLabels {
    private static final Pattern NUMBERED_TITLE = Pattern.compile(
            "^(?:Chương|Chapter)\\s+\\d+\\b\\s*[:.\\-–—]?\\s*",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE
    );

    private ChapterLabels() {
    }

    static String shortTitle(int order, String title) {
        String safeTitle = title == null ? "" : title.trim();
        Matcher match = NUMBERED_TITLE.matcher(safeTitle);
        if (match.find()) {
            String remainder = safeTitle.substring(match.end()).trim();
            if (!remainder.isEmpty()) return remainder;
        }
        return safeTitle.isEmpty() ? "Chương " + order : safeTitle;
    }

    static String fullLabel(Context context, int order, String title) {
        String safeTitle = title == null ? "" : title.trim();
        if (safeTitle.isEmpty()) return "Chương " + order;
        if (NUMBERED_TITLE.matcher(safeTitle).find()) return safeTitle;
        return context.getString(R.string.chapter_row, order, safeTitle);
    }
}
