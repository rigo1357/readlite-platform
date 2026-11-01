package com.readlite.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class StoryCoverUrlPolicyTest {
    @Test
    public void resolvesRelativeCoverUnderConfiguredApiOrigin() {
        assertEquals(
                "http://10.0.2.2:3000/api/v1/media/7",
                StoryCoverUrlPolicy.resolve(
                        "http://10.0.2.2:3000",
                        "/api/v1/media/7"
                )
        );
    }

    @Test
    public void acceptsAbsoluteUrlOnlyWhenOriginMatches() {
        assertEquals(
                "https://readlite.example/api/v1/media/cover.webp",
                StoryCoverUrlPolicy.resolve(
                        "https://readlite.example/api/v1",
                        "https://readlite.example/api/v1/media/cover.webp"
                )
        );
        assertNull(StoryCoverUrlPolicy.resolve(
                "https://readlite.example",
                "https://images.example/cover.webp"
        ));
        assertNull(StoryCoverUrlPolicy.resolve(
                "https://readlite.example",
                "https://readlite.example:444/cover.webp"
        ));
    }

    @Test
    public void rejectsNonHttpSchemesAndCredentialUrls() {
        assertNull(StoryCoverUrlPolicy.resolve(
                "https://readlite.example",
                "file:///private/cover.webp"
        ));
        assertNull(StoryCoverUrlPolicy.resolve(
                "https://readlite.example",
                "data:image/png;base64,abc"
        ));
        assertNull(StoryCoverUrlPolicy.resolve(
                "https://readlite.example",
                "https://user:pass@readlite.example/cover.webp"
        ));
    }

    @Test
    public void blankOrMalformedUrlsReturnNull() {
        assertNull(StoryCoverUrlPolicy.resolve("https://readlite.example", " "));
        assertNull(StoryCoverUrlPolicy.resolve("not a url", "cover.webp"));
    }
}