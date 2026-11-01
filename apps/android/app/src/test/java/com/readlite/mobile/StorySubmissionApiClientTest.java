package com.readlite.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class StorySubmissionApiClientTest {
    @Test
    public void coverUploadsOnlyAcceptRasterTypes() {
        assertTrue(StorySubmissionApiClient.isAllowedCoverType("image/png"));
        assertTrue(StorySubmissionApiClient.isAllowedCoverType("image/jpeg"));
        assertTrue(StorySubmissionApiClient.isAllowedCoverType("image/webp"));
        assertEquals("cover.jpg", StorySubmissionApiClient.coverFallbackFilename("image/jpeg"));
        assertEquals("cover.png", StorySubmissionApiClient.coverFallbackFilename("image/png"));
        assertEquals("cover.webp", StorySubmissionApiClient.coverFallbackFilename("image/webp"));
        assertFalse(StorySubmissionApiClient.isAllowedCoverType("image/svg+xml"));
        assertFalse(StorySubmissionApiClient.isAllowedCoverType("text/html"));
    }

    @Test
    public void uploadFilenameCannotInjectMultipartHeadersOrPaths() {
        assertEquals(".._secret_.epub", StorySubmissionApiClient.safeUploadFilename("../secret\".epub", "story.epub"));
        assertEquals("story.epub", StorySubmissionApiClient.safeUploadFilename("\r\n\"\\", "story.epub"));
        assertEquals(120, StorySubmissionApiClient.safeUploadFilename("x".repeat(150), "story.epub").length());
    }
}
