package com.readlite.mobile;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;

public final class CatalogUrlBuilder {
    private CatalogUrlBuilder() {
    }

    public static String build(
            String baseUrl,
            String path,
            Map<String, String> query
    ) {
        String normalizedBase = baseUrl.replaceAll("/+$", "");
        String normalizedPath = path.startsWith("/") ? path : "/" + path;
        StringBuilder result = new StringBuilder(normalizedBase)
                .append(normalizedPath);

        boolean hasParameter = false;

        if (query != null) {
            for (Map.Entry<String, String> entry : query.entrySet()) {
                String value = entry.getValue();

                if (value == null || value.isEmpty()) {
                    continue;
                }

                result.append(hasParameter ? '&' : '?');
                result.append(URLEncoder.encode(
                        entry.getKey(),
                        StandardCharsets.UTF_8
                ));
                result.append('=');
                result.append(URLEncoder.encode(
                        value,
                        StandardCharsets.UTF_8
                ));

                hasParameter = true;
            }
        }

        return result.toString();
    }
}