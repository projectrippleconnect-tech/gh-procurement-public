/** Descriptive item text fields; IDs and numeric fields must never be normalized. */
export declare const ITEM_TEXT_FIELDS: ReadonlyArray<string>
export declare function uppercaseItemText(value: unknown): string
export declare function normalizeItemText(value: unknown): string
export declare function uppercaseItemAttributes<T extends Record<string, unknown>>(item: T): T
