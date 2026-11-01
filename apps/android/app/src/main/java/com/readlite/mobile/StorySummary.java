package com.readlite.mobile;

import org.json.JSONObject;

public final class StorySummary {
    public final String id;
    public final String title;
    public final String author;
    public final String coverUrl;
    public final double ratingAvg;
    public final int ratingCount;
    public final int totalChapters;

    private StorySummary(
            String id,
            String title,
            String author,
            String coverUrl,
            double ratingAvg,
            int ratingCount,
            int totalChapters
    ) {
        this.id = id;
        this.title = title;
        this.author = author;
        this.coverUrl = coverUrl;
        this.ratingAvg = ratingAvg;
        this.ratingCount = ratingCount;
        this.totalChapters = totalChapters;
    }

    public static StorySummary fromJson(JSONObject json) {
        if (json == null) {
            return new StorySummary("", "", "", "", 0.0, 0, 0);
        }

        double rating = json.optDouble("ratingAvg", 0.0);
        if (!Double.isFinite(rating) || rating < 0.0) {
            rating = 0.0;
        } else {
            rating = Math.min(rating, 5.0);
        }

        return new StorySummary(
                readString(json, "id"),
                readString(json, "title"),
                readString(json, "author"),
                readString(json, "coverUrl"),
                rating,
                Math.max(0, json.optInt("ratingCount", 0)),
                Math.max(0, json.optInt("totalChapters", 0))
        );
    }

    private static String readString(JSONObject json, String key) {
        if (json.isNull(key)) return "";
        String value = json.optString(key, "");
        return value == null ? "" : value.trim();
    }
}
