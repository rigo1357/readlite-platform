package com.readlite.mobile;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;

import org.junit.Test;

public class ReaderChapterSelectionTest {
    @Test
    public void resumesSavedChapterWhenItStillExists() {
        ReaderChapterSelection.Selection selection = ReaderChapterSelection.choose(
                Arrays.asList("chapter-1", "chapter-2"),
                "chapter-1",
                "chapter-2",
                true
        );

        assertEquals("chapter-2", selection.chapterId);
        assertFalse(selection.recovered);
    }

    @Test
    public void fallsBackToFirstChapterWhenSavedChapterWasRemoved() {
        ReaderChapterSelection.Selection selection = ReaderChapterSelection.choose(
                Arrays.asList("chapter-1", "chapter-3"),
                "chapter-2",
                "chapter-2",
                true
        );

        assertEquals("chapter-1", selection.chapterId);
        assertTrue(selection.recovered);
    }

    @Test
    public void usesRequestedChapterWhenResumeIsNotRequested() {
        ReaderChapterSelection.Selection selection = ReaderChapterSelection.choose(
                Arrays.asList("chapter-1", "chapter-2"),
                "chapter-1",
                "chapter-2",
                false
        );

        assertEquals("chapter-1", selection.chapterId);
        assertFalse(selection.recovered);
    }

    @Test
    public void emptyChapterListHasNoSelection() {
        ReaderChapterSelection.Selection selection = ReaderChapterSelection.choose(
                Collections.emptyList(),
                "chapter-1",
                null,
                false
        );

        assertNull(selection.chapterId);
        assertFalse(selection.recovered);
    }
}
