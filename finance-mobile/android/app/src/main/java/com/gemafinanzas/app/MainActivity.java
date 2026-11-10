package com.gemafinanzas.app;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(BankNotificationsPlugin.class);
        registerPlugin(FinanceFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
