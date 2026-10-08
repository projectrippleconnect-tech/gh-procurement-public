package lk.generalhardware.procurement;
import static org.junit.Assert.*;
import org.junit.Test;
public class PhoneNumbersTest {
    @Test public void sriLankaLocalMobile() { assertEquals("94771234567", PhoneNumbers.normalize("077 123 4567")); }
    @Test public void internationalMobile() { assertEquals("94771234567", PhoneNumbers.normalize("+94 77 123 4567")); }
    @Test public void otherCountry() { assertEquals("966556094835", PhoneNumbers.normalize("+966 55 609 4835")); }
    @Test public void dialPrefix() { assertEquals("94771234567", PhoneNumbers.normalize("0094771234567")); }
    @Test public void rejectsGarbage() {
        assertNull(PhoneNumbers.normalize("not a number"));
        assertNull(PhoneNumbers.normalize("0000000"));
        assertNull(PhoneNumbers.normalize(null));
    }
}
