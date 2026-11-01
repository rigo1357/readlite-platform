package com.readlite.mobile;

import java.util.List;

public final class ReaderChapterSelection {
    public static final class Selection {
        public final String chapterId;
        public final boolean recovered;

        private Selection(String chapterId, boolean recovered) {
            this.chapterId = chapterId;
            this.recovered = recovered;
        }
    }

    private ReaderChapterSelection() {
    }

    public static Selection choose(
            List<String> chapterIds,
            String requestedChapterId,
            String savedChapterId,
            boolean resumeSaved
    ) {
        String preferredChapterId = resumeSaved && hasText(savedChapterId)
                ? savedChapterId.trim()
                : trim(requestedChapterId);
        if (chapterIds == null || chapterIds.isEmpty()) {
            return new Selection(null, false);
        }

        if (hasText(preferredChapterId)) {
            for (String chapterId : chapterIds) {
                if (preferredChapterId.equals(trim(chapterId))) {
                    return new Selection(preferredChapterId, false);
                }
            }
        }

        for (String chapterId : chapterIds) {
            String firstValidChapterId = trim(chapterId);
            if (hasText(firstValidChapterId)) {
                return new Selection(
                        firstValidChapterId,
                        hasText(preferredChapterId)
                );
            }
        }
        return new Selection(null, false);
    }

    private static boolean hasText(String value) {
        return value != null && !value.trim().isEmpty();
    }

    private static String trim(String value) {
        return value == null ? "" : value.trim();
    }
}
