import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockQuickbooksClient, mockQuickbooksClientClass, mockQuickBooksInstance, resetAllMocks } from '../../mocks/quickbooks.mock';

// ESM-compatible module mocking. Tool modules import the handlers, which import the client.
jest.unstable_mockModule('../../../src/clients/quickbooks-client', () => ({
  quickbooksClient: mockQuickbooksClient,
  QuickbooksClient: mockQuickbooksClientClass,
}));

const { createQuickbooksInvoice } = await import('../../../src/handlers/create-quickbooks-invoice.handler');
const { updateQuickbooksInvoice } = await import('../../../src/handlers/update-quickbooks-invoice.handler');
const { CreateInvoiceTool } = await import('../../../src/tools/create-invoice.tool');
const { UpdateInvoiceTool } = await import('../../../src/tools/update-invoice.tool');

const createTool = CreateInvoiceTool.handler as (args: any) => Promise<any>;
const updateTool = UpdateInvoiceTool.handler as (args: any) => Promise<any>;

// Sub-customer / job: QBO addresses it by its own Customer Id, not the parent.
const JOB_CUSTOMER_ID = '88';

const fromEstimateInput = {
  customer_ref: JOB_CUSTOMER_ID,
  txn_date: '2026-10-01',
  due_date: '2026-11-23',
  linked_txn: [{ txn_id: '1001', txn_type: 'Estimate' }],
  line_items: [
    {
      item_ref: '10',
      qty: 1,
      unit_price: 150,
      description: 'Adjustment',
      class_ref: '55',
      linked_txn: [{ txn_id: '1001', txn_type: 'Estimate', txn_line_id: '1' }],
    },
  ],
};

/** Invoice already created from estimate 1001, as getInvoice would return it. */
function invoiceFromFirstEstimate() {
  return {
    Id: '500',
    SyncToken: '0',
    CustomerRef: { value: JOB_CUSTOMER_ID, name: 'Practice:Barn Job' },
    TxnDate: '2026-10-01',
    DueDate: '2026-11-23',
    LinkedTxn: [{ TxnId: '1001', TxnType: 'Estimate' }],
    Line: [
      {
        Id: '1',
        LineNum: 1,
        Amount: 150,
        Description: 'Adjustment',
        DetailType: 'SalesItemLineDetail',
        SalesItemLineDetail: {
          ItemRef: { value: '10', name: 'Adjustment' },
          Qty: 1,
          UnitPrice: 150,
          ClassRef: { value: '55', name: 'Barn' },
        },
        LinkedTxn: [{ TxnId: '1001', TxnType: 'Estimate', TxnLineId: '1' }],
      },
    ],
  };
}

const secondEstimateLine = {
  Amount: 75,
  Description: 'Follow-up',
  DetailType: 'SalesItemLineDetail',
  SalesItemLineDetail: {
    ItemRef: { value: '11' },
    Qty: 1,
    UnitPrice: 75,
    ClassRef: { value: '55' },
  },
  LinkedTxn: [{ TxnId: '1002', TxnType: 'Estimate', TxnLineId: '1' }],
};

describe('create_invoice from an estimate', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it('accepts LinkedTxn, TxnDate, DueDate, and line ClassRef on the tool schema', () => {
    const parsed = CreateInvoiceTool.schema.safeParse(fromEstimateInput);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.txn_date).toBe('2026-10-01');
    expect(parsed.data.due_date).toBe('2026-11-23');
    expect(parsed.data.linked_txn).toEqual([{ txn_id: '1001', txn_type: 'Estimate' }]);
    expect(parsed.data.line_items[0].class_ref).toBe('55');
    expect(parsed.data.line_items[0].linked_txn).toEqual([
      { txn_id: '1001', txn_type: 'Estimate', txn_line_id: '1' },
    ]);
  });

  it('sends header LinkedTxn, line LinkedTxn, TxnDate, DueDate, and line ClassRef', async () => {
    const mockInvoice = { Id: '500', TotalAmt: 150 };
    mockQuickBooksInstance.createInvoice.mockImplementation((_payload: any, cb: any) => cb(null, mockInvoice));

    const parsed = CreateInvoiceTool.schema.parse(fromEstimateInput);
    const result = await createQuickbooksInvoice(parsed);

    expect(result.isError).toBe(false);
    const payload = mockQuickBooksInstance.createInvoice.mock.calls[0][0] as any;
    expect(payload.CustomerRef).toEqual({ value: JOB_CUSTOMER_ID });
    expect(payload.TxnDate).toBe('2026-10-01');
    expect(payload.DueDate).toBe('2026-11-23');
    expect(payload.LinkedTxn).toEqual([{ TxnId: '1001', TxnType: 'Estimate' }]);
    expect(payload.ClassRef).toBeUndefined();
    expect(payload.Line).toHaveLength(1);
    expect(payload.Line[0].Amount).toBe(150);
    expect(payload.Line[0].DetailType).toBe('SalesItemLineDetail');
    expect(payload.Line[0].SalesItemLineDetail.ClassRef).toEqual({ value: '55' });
    expect(payload.Line[0].SalesItemLineDetail.ItemRef).toEqual({ value: '10' });
    expect(payload.Line[0].LinkedTxn).toEqual([
      { TxnId: '1001', TxnType: 'Estimate', TxnLineId: '1' },
    ]);
  });

  it('sends a transaction-level ClassRef when class_ref is set and omits a line ClassRef', async () => {
    mockQuickBooksInstance.createInvoice.mockImplementation((_payload: any, cb: any) => cb(null, { Id: '501' }));

    const result = await createQuickbooksInvoice({
      customer_ref: JOB_CUSTOMER_ID,
      class_ref: '55',
      line_items: [{ item_ref: '10', qty: 1, unit_price: 150 }],
    });

    expect(result.isError).toBe(false);
    const payload = mockQuickBooksInstance.createInvoice.mock.calls[0][0] as any;
    expect(payload.ClassRef).toEqual({ value: '55' });
    expect(payload.Line[0].SalesItemLineDetail.ClassRef).toBeUndefined();
    expect(payload.DueDate).toBeUndefined();
    expect(payload.LinkedTxn).toBeUndefined();
    expect(payload.Line[0].LinkedTxn).toBeUndefined();
  });
});

describe('update_invoice adds a second estimate for the same customer', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it('accepts TxnDate, DueDate, ClassRef, Line, and LinkedTxn inside patch', () => {
    const existing = invoiceFromFirstEstimate();
    const parsed = UpdateInvoiceTool.schema.safeParse({
      invoice_id: '500',
      patch: {
        TxnDate: '2026-10-01',
        DueDate: '2026-11-23',
        LinkedTxn: [
          { TxnId: '1001', TxnType: 'Estimate' },
          { TxnId: '1002', TxnType: 'Estimate' },
        ],
        Line: [...existing.Line, secondEstimateLine],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('sends the original lines plus the second estimate, and both header LinkedTxn entries', async () => {
    const existing = invoiceFromFirstEstimate();
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, existing));
    mockQuickBooksInstance.updateInvoice.mockImplementation((_payload: any, cb: any) =>
      cb(null, { ...existing, SyncToken: '1' })
    );

    const result = await updateQuickbooksInvoice({
      invoice_id: '500',
      patch: {
        Line: [...existing.Line, secondEstimateLine],
        LinkedTxn: [
          { TxnId: '1001', TxnType: 'Estimate' },
          { TxnId: '1002', TxnType: 'Estimate' },
        ],
      },
    });

    expect(result.isError).toBe(false);
    const payload = mockQuickBooksInstance.updateInvoice.mock.calls[0][0] as any;
    expect(payload.Id).toBe('500');
    expect(payload.SyncToken).toBe('0');
    expect(payload.sparse).toBe(true);
    expect(payload.CustomerRef).toEqual({ value: JOB_CUSTOMER_ID, name: 'Practice:Barn Job' });
    expect(payload.TxnDate).toBe('2026-10-01');
    expect(payload.DueDate).toBe('2026-11-23');
    expect(payload.LinkedTxn).toEqual([
      { TxnId: '1001', TxnType: 'Estimate' },
      { TxnId: '1002', TxnType: 'Estimate' },
    ]);
    expect(payload.Line).toHaveLength(2);
    expect(payload.Line[0].SalesItemLineDetail.ClassRef).toEqual({ value: '55', name: 'Barn' });
    expect(payload.Line[0].LinkedTxn).toEqual([
      { TxnId: '1001', TxnType: 'Estimate', TxnLineId: '1' },
    ]);
    expect(payload.Line[1]).toEqual(secondEstimateLine);
    expect(payload.Line[1].LinkedTxn).toEqual([
      { TxnId: '1002', TxnType: 'Estimate', TxnLineId: '1' },
    ]);
    expect(payload.Line[1].SalesItemLineDetail.ClassRef).toEqual({ value: '55' });
  });

  it('replaces LinkedTxn with exactly the list in the patch and keeps lines that were not sent', async () => {
    const existing = invoiceFromFirstEstimate();
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, existing));
    mockQuickBooksInstance.updateInvoice.mockImplementation((_payload: any, cb: any) => cb(null, existing));

    await updateQuickbooksInvoice({
      invoice_id: '500',
      patch: {
        LinkedTxn: [{ TxnId: '1002', TxnType: 'Estimate' }],
      },
    });

    const payload = mockQuickBooksInstance.updateInvoice.mock.calls[0][0] as any;
    expect(payload.LinkedTxn).toEqual([{ TxnId: '1002', TxnType: 'Estimate' }]);
    expect(payload.Line).toEqual(existing.Line);
    expect(payload.CustomerRef).toEqual(existing.CustomerRef);
  });

  it('returns an error when the invoice cannot be read', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(new Error('missing invoice')));

    const result = await updateQuickbooksInvoice({ invoice_id: '500', patch: { DueDate: '2026-11-23' } });

    expect(result.isError).toBe(true);
    expect(result.error).toContain('missing invoice');
    expect(mockQuickBooksInstance.updateInvoice).not.toHaveBeenCalled();
  });

  it('returns an error when QuickBooks rejects the update', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, invoiceFromFirstEstimate()));
    mockQuickBooksInstance.updateInvoice.mockImplementation((_payload: any, cb: any) => cb(new Error('stale object')));

    const result = await updateQuickbooksInvoice({ invoice_id: '500', patch: { DueDate: '2026-11-23' } });

    expect(result.isError).toBe(true);
    expect(result.error).toContain('stale object');
  });

  it('returns an error when the client cannot be created', async () => {
    (mockQuickbooksClientClass.getInstance as any).mockRejectedValue(new Error('Auth failed'));

    const result = await updateQuickbooksInvoice({ invoice_id: '500', patch: {} });

    expect(result.isError).toBe(true);
    expect(result.error).toContain('Auth failed');
  });
});

describe('invoice tool handlers', () => {
  beforeEach(() => {
    resetAllMocks();
  });

  it('create_invoice handler returns the created invoice', async () => {
    mockQuickBooksInstance.createInvoice.mockImplementation((_payload: any, cb: any) => cb(null, { Id: '500' }));

    const result = await createTool({ params: fromEstimateInput });

    expect(result.content[0].text).toContain('Invoice created successfully');
    expect(result.content[1].text).toContain('"Id": "500"');
  });

  it('create_invoice handler returns an error message on failure', async () => {
    mockQuickBooksInstance.createInvoice.mockImplementation((_payload: any, cb: any) => cb(new Error('rejected')));

    const result = await createTool({ params: fromEstimateInput });

    expect(result.content[0].text).toContain('Error creating invoice');
    expect(result.content[0].text).toContain('rejected');
  });

  it('update_invoice handler returns the updated invoice', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(null, invoiceFromFirstEstimate()));
    mockQuickBooksInstance.updateInvoice.mockImplementation((_payload: any, cb: any) =>
      cb(null, { Id: '500', SyncToken: '1' })
    );

    const result = await updateTool({
      params: {
        invoice_id: '500',
        patch: { LinkedTxn: [{ TxnId: '1002', TxnType: 'Estimate' }] },
      },
    });

    expect(result.content[0].text).toContain('Invoice updated successfully');
    expect(result.content[1].text).toContain('"SyncToken": "1"');
  });

  it('update_invoice handler returns an error message on failure', async () => {
    mockQuickBooksInstance.getInvoice.mockImplementation((_id: any, cb: any) => cb(new Error('missing invoice')));

    const result = await updateTool({ params: { invoice_id: '500', patch: {} } });

    expect(result.content[0].text).toContain('Error updating invoice');
    expect(result.content[0].text).toContain('missing invoice');
  });
});
