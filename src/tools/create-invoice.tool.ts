import { createQuickbooksInvoice } from "../handlers/create-quickbooks-invoice.handler.js";
import { ToolDefinition } from "../types/tool-definition.js";
import { z } from "zod";

const toolName = "create_invoice";
const toolDescription =
  "Create an invoice in QuickBooks Online. To create it from an estimate, set linked_txn to one or more { txn_id, txn_type: 'Estimate' } entries (header LinkedTxn; repeat the entry for each estimate) and copy that estimate's sales lines into line_items. " +
  "Each line may also set linked_txn with txn_line_id equal to the estimate line Id so the line points at its source line. " +
  "customer_ref is the Customer Id; a sub-customer or job is that job's own Id, not the parent. " +
  "Set txn_date and due_date as YYYY-MM-DD. Set each line's class_ref when the company tracks class per line, or the invoice class_ref when it tracks class per transaction (send only the level the company preference uses).";

const linkedTxnSchema = z.object({
  txn_id: z.string().min(1).describe("Id of the linked transaction, for example the estimate Id"),
  txn_type: z.string().min(1).describe("Transaction type. Use 'Estimate' to link an estimate"),
  txn_line_id: z
    .string()
    .min(1)
    .optional()
    .describe("Source line Id (Line.Id, not LineNum). Set this on a line link. Omit it on the invoice header when linking the whole estimate."),
});

const lineItemSchema = z.object({
  item_ref: z.string().min(1),
  qty: z.number().positive(),
  unit_price: z.number().nonnegative(),
  description: z.string().optional(),
  tax_code_ref: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Tax code for this line: a TaxCode Id for non-US companies (use search_tax_codes), or 'TAX'/'NON' for US companies"
    ),
  service_date: z
    .string()
    .min(1)
    .optional()
    .describe("Date the service was performed (YYYY-MM-DD), shown per line on the invoice"),
  class_ref: z
    .string()
    .min(1)
    .optional()
    .describe("Class Id for this line (SalesItemLineDetail.ClassRef). Use when the company tracks class on each row."),
  linked_txn: z
    .array(linkedTxnSchema)
    .optional()
    .describe(
      "Source transaction for this line. For an estimate line set txn_type to 'Estimate', txn_id to the estimate Id, and txn_line_id to that estimate line's Id."
    ),
});

const toolSchema = z.object({
  customer_ref: z.string().min(1).describe("Customer Id. A sub-customer/job uses that job's own Customer Id."),
  line_items: z.array(lineItemSchema).min(1),
  doc_number: z.string().optional(),
  txn_date: z.string().optional().describe("Transaction date (YYYY-MM-DD), for example 2026-10-01"),
  due_date: z.string().optional().describe("Date the invoice is due (YYYY-MM-DD), for example 2026-11-23"),
  class_ref: z
    .string()
    .min(1)
    .optional()
    .describe("Class Id for the whole invoice (ClassRef). Use when the company tracks class per transaction, not per line."),
  linked_txn: z
    .array(linkedTxnSchema)
    .optional()
    .describe(
      "Transactions this invoice is created from. For an estimate, txn_type is 'Estimate' and txn_id is the estimate Id. Pass one entry per estimate. QBO only associates Pending or Accepted estimates."
    ),
  global_tax_calculation: z
    .enum(["TaxExcluded", "TaxInclusive", "NotApplicable"])
    .optional()
    .describe("Non-US companies only: whether unit prices exclude or include tax"),
  customer_memo: z
    .string()
    .min(1)
    .optional()
    .describe("Customer-facing message printed on the invoice (QBO CustomerMemo)"),
  sales_term_ref: z
    .string()
    .min(1)
    .optional()
    .describe("Sales term Id (use search_terms), e.g. Net 30. Falls back to the customer default if omitted"),
  bill_email: z
    .string()
    .min(1)
    .optional()
    .describe("Billing email address (QBO BillEmail). Falls back to the customer default if omitted"),
});

const toolHandler = async ({ params }: any) => {
  const response = await createQuickbooksInvoice(params);
  if (response.isError) {
    return { content: [{ type: "text" as const, text: `Error creating invoice: ${response.error}` }] };
  }
  return {
    content: [
      { type: "text" as const, text: `Invoice created successfully:` },
      { type: "text" as const, text: JSON.stringify(response.result, null, 2) },
    ],
  };
};

export const CreateInvoiceTool: ToolDefinition<typeof toolSchema> = {
  name: toolName,
  description: toolDescription,
  schema: toolSchema,
  handler: toolHandler,
}; 