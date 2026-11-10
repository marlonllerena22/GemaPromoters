package com.gemafinanzas.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class BankNotificationPrivacyTest {
    @Test public void authenticationTextNeverEntersTheUploadQueue(){
        for(String text:new String[]{"Tu código es 123456","Código de seguridad 123456","OTP 654321","Tu clave temporal es 123456","Contraseña cambiada","Inicio de sesión detectado","Verificación de acceso"}){
            assertTrue(text,BankNotificationListener.sensitive(text));
        }
    }
    @Test public void paymentReferencesAreNotMistakenForAccessCodes(){
        for(String text:new String[]{"Recibiste $25 de Ana. Referencia 12345678","Transferencia enviada $10. Comprobante 98765432","Deuna: Pagaste $15,00"}){
            assertFalse(text,BankNotificationListener.sensitive(text));
        }
    }
}
