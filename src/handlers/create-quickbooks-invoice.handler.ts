import { QuickbooksClient } from "../clients/quickbooks-client.js";
import { ToolResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";

/** Header or line link. txn_line_id is the source transaction's line Id (Line.Id). */
interface LinkedTxnInput {
  txn_id: string;
  txn_type: string;
  txn_line_id?: string;
}

/**
 * Map tool linked-transaction entries to QBO LinkedTxn.
 * TxnLineId is omitted unless the caller names a specific source line.
 */
function toLinkedTxn(linked: LinkedTxnInput[]) {
  return linked.map((lt) => ({
    TxnId: lt.txn_id,
    TxnType: lt.txn_type,
    ...(lt.txn_line_id ? { TxnLineId: lt.txn_line_id } : {}),
  }));
}

export interface CreateInvoiceInput {
  customer_ref: string; // customer id; a sub-customer/job is that job's own Customer Id
  line_items: Array<{
    item_ref: string; // item id
    qty: number;
    unit_price: number;
    description?: string;
    tax_code_ref?: string; // TaxCode id (non-US) or TAX/NON (US)
    service_date?: string; // YYYY-MM-DD, per-line ServiceDate
    class_ref?: string; // Class Id when the company tracks class per line
    linked_txn?: LinkedTxnInput[]; // line-level link, e.g. one estimate line
  }>;
  doc_number?: string;
  txn_date?: string; // YYYY-MM-DD
  due_date?: string; // YYYY-MM-DD
  class_ref?: string; // Class Id when the company tracks class per transaction
  linked_txn?: LinkedTxnInput[]; // header links; repeat to attach more than one estimate
  global_tax_calculation?: "TaxExcluded" | "TaxInclusive" | "NotApplicable";
  customer_memo?: string; // CustomerMemo (customer-facing message)
  sales_term_ref?: string; // SalesTerm id; falls back to customer default
  bill_email?: string; // BillEmail address; falls back to customer default
}

// Primitive field type map (based on Quickbooks Invoice entity reference docs)
const invoiceFieldTypeMap: Record<string, "string" | "number" | "boolean"> = {
  DocNumber: "string",
  TxnDate: "string",
  DueDate: "string",
  PrivateNote: "string",
  GlobalTaxCalculation: "string",
  ApplyTaxAfterDiscount: "boolean",
  TotalAmt: "number",
};

/**
 * Coerce primitive invoice fields to the expected QuickBooks Online types.
 */
function normalizeInvoiceFields(obj: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = { ...obj };
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined || value === null) continue;
    const expected = invoiceFieldTypeMap[key];
    if (!expected) continue; // skip if not a primitive field we validate

    switch (expected) {
      case "string":
        normalized[key] = String(value);
        break;
      /* istanbul ignore next — defensive: the payload built by
         createQuickbooksInvoice only contains string-typed mapped fields */
      case "number":
        normalized[key] = typeof value === "number" ? value : Number(value);
        break;
      /* istanbul ignore next — defensive: same as above */
      case "boolean":
        normalized[key] = typeof value === "boolean" ? value : value === "true";
        break;
    }
  }
  return normalized;
}

export async function createQuickbooksInvoice(data: CreateInvoiceInput): Promise<ToolResponse<any>> {
  try {
    const quickbooks = await QuickbooksClient.getInstance();

    const invoicePayload: any = {
      CustomerRef: { value: data.customer_ref },
      Line: data.line_items.map((l, idx) => ({
        Id: `${idx + 1}`,
        LineNum: idx + 1,
        Description: l.description || undefined,
        Amount: l.qty * l.unit_price,
        DetailType: "SalesItemLineDetail",
        SalesItemLineDetail: {
          ItemRef: { value: l.item_ref },
          Qty: l.qty,
          UnitPrice: l.unit_price,
          TaxCodeRef: l.tax_code_ref ? { value: l.tax_code_ref } : undefined,
          ServiceDate: l.service_date || undefined,
          ClassRef: l.class_ref ? { value: l.class_ref } : undefined,
        },
        ...(l.linked_txn ? { LinkedTxn: toLinkedTxn(l.linked_txn) } : {}),
      })),
      DocNumber: data.doc_number,
      TxnDate: data.txn_date,
      ...(data.due_date ? { DueDate: data.due_date } : {}),
      ...(data.class_ref ? { ClassRef: { value: data.class_ref } } : {}),
      ...(data.linked_txn && {
        LinkedTxn: toLinkedTxn(data.linked_txn),
      }),
      ...(data.customer_memo && { CustomerMemo: { value: data.customer_memo } }),
      ...(data.sales_term_ref && { SalesTermRef: { value: data.sales_term_ref } }),
      ...(data.bill_email && { BillEmail: { Address: data.bill_email } }),
    };

    if (data.global_tax_calculation) {
      invoicePayload.GlobalTaxCalculation = data.global_tax_calculation;
    }

    const normalizedPayload = normalizeInvoiceFields(invoicePayload);

    return new Promise((resolve) => {
      (quickbooks as any).createInvoice(normalizedPayload, (err: any, created: any) => {
        if (err) {
          resolve({ result: null, isError: true, error: formatError(err) });
        } else {
          resolve({ result: created, isError: false, error: null });
        }
      });
    });
  } catch (error) {
    return { result: null, isError: true, error: formatError(error) };
  }
} 
