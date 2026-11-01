package com.readlite.mobile;

public final class ReaderProgress {
    private static final int MAX_PERMILLE = 1000;

    private ReaderProgress() {
    }

    public static int toPermille(int scrollY, int scrollRange) {
        if (scrollRange <= 0) {
            return 0;
        }

        int clampedScrollY = Math.max(0, Math.min(scrollY, scrollRange));
        return Math.round((clampedScrollY * (float) MAX_PERMILLE) / scrollRange);
    }

    public static int toScrollY(int positionPermille, int scrollRange) {
        if (scrollRange <= 0) {
            return 0;
        }

        int clampedPermille = Math.max(0, Math.min(positionPermille, MAX_PERMILLE));
        return Math.round((scrollRange * (float) clampedPermille) / MAX_PERMILLE);
    }
}
