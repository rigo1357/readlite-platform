package com.readlite.mobile;

import static org.junit.Assert.assertEquals;

import java.util.LinkedHashMap;
import java.util.Map;

import org.junit.Test;

public class CatalogUrlBuilderTest {
    @Test
    public void buildUrlEncodesQueryAndRemovesExtraSlashes() {
        Map<String, String> query = new LinkedHashMap<>();
        query.put("q", "Fantasy & Drama");
        query.put("page", "1");

        String result = CatalogUrlBuilder.build(
                "http://10.0.2.2:3000/",
                "/api/v1/stories",
                query
        );

        assertEquals(
                "http://10.0.2.2:3000/api/v1/stories?q=Fantasy+%26+Drama&page=1",
                result
        );
    }

    @Test
    public void encodesVietnameseSearchAndPreservesCatalogFilters() {
        Map<String, String> query = new LinkedHashMap<>();
        query.put("q", "Kiếm hiệp & ma pháp");
        query.put("genre", "kiem-hiep");
        query.put("sort", "top_rated");
        query.put("page", "2");
        query.put("limit", "20");

        String result = CatalogUrlBuilder.build(
                "http://10.0.2.2:3000",
                "api/v1/stories",
                query
        );

        assertEquals(
                "http://10.0.2.2:3000/api/v1/stories"
                        + "?q=Ki%E1%BA%BFm+hi%E1%BB%87p+%26+ma+ph%C3%A1p"
                        + "&genre=kiem-hiep&sort=top_rated&page=2&limit=20",
                result
        );
    }

    @Test
    public void omitsEmptyOptionalFilters() {
        Map<String, String> query = new LinkedHashMap<>();
        query.put("q", "");
        query.put("genre", null);
        query.put("sort", "newest");

        assertEquals(
                "https://readlite.example/api/v1/stories?sort=newest",
                CatalogUrlBuilder.build(
                        "https://readlite.example/",
                        "/api/v1/stories",
                        query
                )
        );
    }
}