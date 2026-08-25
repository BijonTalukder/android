package com.example.gateway.sms;

import static org.junit.Assert.assertEquals;

import com.example.gateway.sms.AndroidSmsSender;

import org.junit.Test;

/** Segment estimation drives the operator-facing cost warning. */
public class SmsSegmentTest {

    @Test
    public void countsSegmentsAtTheGsm7Boundary() {
        assertEquals(0, AndroidSmsSender.estimateSegments(""));
        assertEquals(1, AndroidSmsSender.estimateSegments("x"));
        assertEquals(1, AndroidSmsSender.estimateSegments(repeat(153)));
        assertEquals(2, AndroidSmsSender.estimateSegments(repeat(154)));
        assertEquals(10, AndroidSmsSender.estimateSegments(repeat(1530)));
    }

    private static String repeat(int count) {
        return new String(new char[count]).replace('\0', 'x');
    }
}
