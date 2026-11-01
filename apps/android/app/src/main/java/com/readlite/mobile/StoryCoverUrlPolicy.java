package com.readlite.mobile;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

public final class StoryCoverUrlPolicy {
    private StoryCoverUrlPolicy() {
    }

    public static String resolve(String apiBaseUrl, String coverUrl) {
        if (apiBaseUrl == null || apiBaseUrl.trim().isEmpty()
                || coverUrl == null || coverUrl.trim().isEmpty()) {
            return null;
        }

        try {
            URI base = new URI(apiBaseUrl.trim());
            URI candidate = base.resolve(new URI(coverUrl.trim())).normalize();
            if (!isHttpOrigin(base) || !isHttpOrigin(candidate)
                    || base.getRawUserInfo() != null
                    || candidate.getRawUserInfo() != null
                    || candidate.getRawFragment() != null
                    || !sameOrigin(base, candidate)) {
                return null;
            }
            return candidate.toASCIIString();
        } catch (IllegalArgumentException | URISyntaxException exception) {
            return null;
        }
    }

    private static boolean isHttpOrigin(URI uri) {
        if (uri.isOpaque() || uri.getHost() == null) {
            return false;
        }
        String scheme = uri.getScheme();
        return "http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme);
    }

    private static boolean sameOrigin(URI first, URI second) {
        return first.getScheme().toLowerCase(Locale.ROOT)
                .equals(second.getScheme().toLowerCase(Locale.ROOT))
                && first.getHost().equalsIgnoreCase(second.getHost())
                && effectivePort(first) == effectivePort(second);
    }

    private static int effectivePort(URI uri) {
        if (uri.getPort() >= 0) {
            return uri.getPort();
        }
        return "https".equalsIgnoreCase(uri.getScheme()) ? 443 : 80;
    }
}