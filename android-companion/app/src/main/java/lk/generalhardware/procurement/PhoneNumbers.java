package lk.generalhardware.procurement;

/** Digits-only WhatsApp recipient, with Sri Lankan local +94 normalization. */
public final class PhoneNumbers {
    private PhoneNumbers() { }
    public static String normalize(String input) {
        if (input == null) return null;
        String s = input.trim().replaceAll("[\\s()+.-]", "");
        if (!s.matches("[0-9]{8,17}")) return null;
        if (s.startsWith("00")) s = s.substring(2);
        if (s.startsWith("0") && s.length() == 10) s = "94" + s.substring(1);
        if (!s.matches("[1-9][0-9]{7,14}")) return null;
        return s;
    }
}
