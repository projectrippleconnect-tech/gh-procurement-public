// PDF rendering is downloaded only after an explicit print/export action.
export async function buildCustomStockPdf(...args){const pdf=await import('./pdf.js');return pdf.buildCustomStockPdf(...args)}
export async function exportTablePdf(...args){const pdf=await import('./pdf.js');return pdf.exportTablePdf(...args)}
export async function exportSupplierPriceRequestPdf(...args){const pdf=await import('./pdf.js');return pdf.exportSupplierPriceRequestPdf(...args)}
export async function exportPurchaseOrderPdf(...args){const pdf=await import('./pdf.js');return pdf.exportPurchaseOrderPdf(...args)}
