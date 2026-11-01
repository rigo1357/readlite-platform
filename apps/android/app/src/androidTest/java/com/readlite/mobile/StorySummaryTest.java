package com.readlite.mobile;

import static org.junit.Assert.assertEquals;

import org.json.JSONObject;
import org.junit.Test;

public class StorySummaryTest {
    @Test
    public void mapsCatalogFieldsFromJson() throws Exception {
        JSONObject json = new JSONObject()
                .put("id", "17")
                .put("title", "ReadLite")
                .put("author", "An Nhiên")
                .put("coverUrl", "https://example.test/cover.jpg")
                .put("ratingAvg", 4.25)
                .put("ratingCount", 18)
                .put("totalChapters", 42);

        StorySummary summary = StorySummary.fromJson(json);

        assertEquals("17", summary.id);
        assertEquals("ReadLite", summary.title);
        assertEquals("An Nhiên", summary.author);
        assertEquals("https://example.test/cover.jpg", summary.coverUrl);
        assertEquals(4.25, summary.ratingAvg, 0.001);
        assertEquals(18, summary.ratingCount);
        assertEquals(42, summary.totalChapters);
    }

    @Test
    public void missingAndNullOptionalValuesUseSafeDefaults() throws Exception {
        JSONObject json = new JSONObject()
                .put("id", "18")
                .put("title", "Không có bìa")
                .put("coverUrl", JSONObject.NULL)
                .put("ratingAvg", JSONObject.NULL)
                .put("ratingCount", JSONObject.NULL)
                .put("totalChapters", JSONObject.NULL);

        StorySummary summary = StorySummary.fromJson(json);

        assertEquals("", summary.coverUrl);
        assertEquals(0.0, summary.ratingAvg, 0.001);
        assertEquals(0, summary.ratingCount);
        assertEquals(0, summary.totalChapters);
    }

    @Test
    public void missingTitleIsNormalizedToEmptyString() throws Exception {
        StorySummary summary = StorySummary.fromJson(new JSONObject().put("id", "19"));

        assertEquals("", summary.title);
    }

    @Test
    public void negativeCountsAndRatingsAreNormalized() throws Exception {
        JSONObject json = new JSONObject()
                .put("id", "20")
                .put("title", "Dữ liệu sai")
                .put("ratingAvg", -2.0)
                .put("ratingCount", -1)
                .put("totalChapters", -5);

        StorySummary summary = StorySummary.fromJson(json);

        assertEquals(0.0, summary.ratingAvg, 0.001);
        assertEquals(0, summary.ratingCount);
        assertEquals(0, summary.totalChapters);
    }
}