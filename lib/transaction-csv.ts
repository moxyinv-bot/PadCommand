import Papa from "papaparse";
import { Property, Transaction } from "@/types/property";

export const TRANSACTION_CSV_HEADERS = [
  "Property Name",
  "Property Address",
  "Transaction Type",
  "Date",
  "Category",
  "Amount",
  "Description",
  "Tags",
  "Receipt Name",
] as const;

export type TransactionImportRow = Omit<Transaction, "id" | "receiptUri"> & {
  propertyName: string;
  propertyAddress: string;
  receiptName?: string;
};

export type TransactionImportResult = {
  valid: TransactionImportRow[];
  errors: string[];
  duplicates: string[];
  totalRows: number;
};

const value = (row: Record<string, string>, header: string): string => (row[header] || "").trim();

const transactionRow = (transaction: Transaction, property?: Property) => ({
  "Property Name": property?.name || "",
  "Property Address": property?.address || "",
  "Transaction Type": transaction.type,
  Date: transaction.date,
  Category: transaction.category,
  Amount: String(transaction.amount),
  Description: transaction.description,
  Tags: transaction.tags.join("; "),
  "Receipt Name": transaction.receiptName || "",
});

export const transactionCsvTemplate = (): string => Papa.unparse([{
  "Property Name": "Live Oak",
  "Property Address": "123 Main Street",
  "Transaction Type": "expense",
  Date: "2026-09-15",
  Category: "Repairs",
  Amount: "425.00",
  Description: "HVAC service",
  Tags: "maintenance; hvac",
  "Receipt Name": "invoice-1042.pdf",
}], { columns: [...TRANSACTION_CSV_HEADERS] });

export const transactionsToCsv = (transactions: Transaction[], properties: Property[]): string => Papa.unparse(
  transactions.map(transaction => transactionRow(transaction, properties.find(property => property.id === transaction.propertyId))),
  { columns: [...TRANSACTION_CSV_HEADERS] },
);

export const parseTransactionCsv = (
  csv: string,
  properties: Property[],
  existingTransactions: Transaction[] = [],
): TransactionImportResult => {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: header => header.trim(),
  });
  const errors: string[] = [];
  const duplicates: string[] = [];
  const valid: TransactionImportRow[] = [];
  const propertyByKey = new Map(properties.map(property => [
    `${property.name.trim().toLowerCase()}|${property.address.trim().toLowerCase()}`,
    property,
  ]));
  const existingKeys = new Set(existingTransactions.map(transaction => {
    const property = properties.find(item => item.id === transaction.propertyId);
    return `${transaction.propertyId}|${transaction.date}|${transaction.type}|${transaction.amount}|${transaction.description.trim().toLowerCase()}`;
  }));

  parsed.errors.forEach(error => errors.push(`CSV row ${error.row + 2}: ${error.message}`));

  parsed.data.forEach((row, index) => {
    const rowNumber = index + 2;
    const propertyName = value(row, "Property Name");
    const propertyAddress = value(row, "Property Address");
    const type = value(row, "Transaction Type").toLowerCase();
    const date = value(row, "Date");
    const category = value(row, "Category") || "Uncategorized";
    const description = value(row, "Description") || "Imported transaction";
    const amountRaw = value(row, "Amount").replace(/[$,\s]/g, "");
    const amount = Number(amountRaw);
    const property = propertyByKey.get(`${propertyName.toLowerCase()}|${propertyAddress.toLowerCase()}`);
    const rowErrors: string[] = [];

    if (!property) rowErrors.push("Property Name and Property Address must match an existing property");
    if (type !== "income" && type !== "expense") rowErrors.push("Transaction Type must be income or expense");
    if (!date || Number.isNaN(new Date(date).getTime())) rowErrors.push("Date must be valid");
    if (!amountRaw || !Number.isFinite(amount) || amount < 0) rowErrors.push("Amount must be a non-negative number");

    if (rowErrors.length > 0) {
      errors.push(`Row ${rowNumber}: ${rowErrors.join("; ")}`);
      return;
    }

    const normalizedDate = new Date(date).toISOString().slice(0, 10);
    const duplicateKey = `${property.id}|${normalizedDate}|${type}|${amount}|${description.trim().toLowerCase()}`;
    if (existingKeys.has(duplicateKey)) {
      duplicates.push(`Row ${rowNumber}: ${description} (${normalizedDate}) already exists`);
      return;
    }

    existingKeys.add(duplicateKey);
    valid.push({
      propertyId: property.id,
      propertyName,
      propertyAddress,
      type: type as Transaction["type"],
      category,
      amount,
      date: normalizedDate,
      description,
      tags: value(row, "Tags").split(/[;,]/).map(tag => tag.trim()).filter(Boolean),
      receiptName: value(row, "Receipt Name") || undefined,
    });
  });

  return { valid, errors, duplicates, totalRows: parsed.data.length };
};
