package com.aorohan.trailbound;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must be registered before the bridge starts, or the web layer's
        // `registerPlugin('Steps')` resolves to nothing.
        registerPlugin(StepsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
