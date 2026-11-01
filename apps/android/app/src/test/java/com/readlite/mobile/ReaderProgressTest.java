package com.readlite.mobile;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public class ReaderProgressTest {
    @Test
    public void convertsScrollPositionToPermilleAndClampsBounds() {
        assertEquals(0, ReaderProgress.toPermille(0, 800));
        assertEquals(500, ReaderProgress.toPermille(400, 800));
        assertEquals(1000, ReaderProgress.toPermille(900, 800));
        assertEquals(0, ReaderProgress.toPermille(-50, 800));
    }

    @Test
    public void convertsPermilleToScrollPositionAndClampsBounds() {
        assertEquals(400, ReaderProgress.toScrollY(500, 800));
        assertEquals(0, ReaderProgress.toScrollY(-5, 800));
        assertEquals(800, ReaderProgress.toScrollY(1005, 800));
        assertEquals(0, ReaderProgress.toScrollY(750, 0));
    }
}
