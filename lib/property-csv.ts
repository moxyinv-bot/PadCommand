import Papa from "papaparse";
import { Property } from "@/types/property";

export const PROPERTY_CSV_HEADERS = [
  "Property Name",
  "Address",
  "Type",
  "Purchase Date",
  "Purchase Price",
  "Current Value",
  "Square Footage",
  "Monthly Rent",
  "Tenant Name",
  "Tenant Contact",
  "Lease Start",
  "Lease End",
  "Mortgage Amount",
  "Mortgage Payment",
  "Mortgage Renewal Date",
  "Insurance Provider",
  "Insurance Policy",
  "Insurance Renewal Date",
  "Insurance Premium",
  "Property Tax",
  "Property Tax Due Date",
  "AC Capacitor Size",
  "AC Filter Size",
  "Paint Colors Inside",
  "Paint Colors Outside",
  "Water Heater Info",
  "Appliance Info",
  "Notes",
] as const;

const PROPERTY_TYPES = new Set<Property["type"]>([
  "single-family",
  "multi-family",
  "condo",
  "townhouse",
  "apartment",
]);

export type PropertyCsvRow = Record<(typeof PROPERTY_CSV_HEADERS)[number], string>;

export type PropertyImportResult = {
  valid: Array<Omit<Property, "id" | "appliances" | "paintColors">>;
  errors: string[];
  duplicates: string[];
  totalRows: number;
};

const value = (row: Record<string, string>, header: string): string => (row[header] || "").trim();

const numberValue = (row: Record<string, string>, header: string): number | undefined => {
  const raw = value(row, header).replace(/[$,\s]/g, "");
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const optionalDate = (row: Record<string, string>, header: string): string | undefined => {
  const raw = value(row, header);
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
};

const csvRow = (property: Property): PropertyCsvRow => ({
  "Property Name": property.name,
  Address: property.address,
  Type: property.type,
  "Purchase Date": property.purchaseDate || "",
  "Purchase Price": String(property.purchasePrice || ""),
  "Current Value": String(property.currentValue ?? ""),
  "Square Footage": String(property.squareFootage ?? ""),
  "Monthly Rent": String(property.monthlyRent || ""),
  "Tenant Name": property.tenantName || "",
  "Tenant Contact": property.tenantContact || "",
  "Lease Start": property.leaseStart || "",
  "Lease End": property.leaseEnd || "",
  "Mortgage Amount": String(property.mortgageAmount ?? ""),
  "Mortgage Payment": String(property.mortgagePayment ?? ""),
  "Mortgage Renewal Date": property.mortgageRenewalDate || "",
  "Insurance Provider": property.insuranceProvider || "",
  "Insurance Policy": property.insurancePolicy || "",
  "Insurance Renewal Date": property.insuranceRenewalDate || "",
  "Insurance Premium": String(property.insurancePremium ?? ""),
  "Property Tax": String(property.propertyTax ?? ""),
  "Property Tax Due Date": property.propertyTaxDueDate || "",
  "AC Capacitor Size": property.acCapacitorSize || "",
  "AC Filter Size": property.acFilterSize || "",
  "Paint Colors Inside": property.paintColorsInside || "",
  "Paint Colors Outside": property.paintColorsOutside || "",
  "Water Heater Info": property.waterHeaterInfo || "",
  "Appliance Info": property.applianceInfo || "",
  Notes: property.notes || "",
});

export const propertyCsvTemplate = (): string => Papa.unparse([Object.fromEntries(PROPERTY_CSV_HEADERS.map(header => [header, ""]))]);

export const propertiesToCsv = (properties: Property[]): string => Papa.unparse(properties.map(csvRow), { columns: [...PROPERTY_CSV_HEADERS] });

export const parsePropertyCsv = (csv: string, existingProperties: Property[] = []): PropertyImportResult => {
  const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true, transformHeader: header => header.trim() });
  const errors: string[] = [];
  const duplicates: string[] = [];
  const valid: PropertyImportResult["valid"] = [];
  const seen = new Set(existingProperties.map(property => `${property.name.trim().toLowerCase()}|${property.address.trim().toLowerCase()}`));

  parsed.errors.forEach(error => errors.push(`CSV row ${error.row + 2}: ${error.message}`));

  parsed.data.forEach((row, index) => {
    const rowNumber = index + 2;
    const name = value(row, "Property Name");
    const address = value(row, "Address");
    const typeValue = value(row, "Type") || "single-family";
    const key = `${name.toLowerCase()}|${address.toLowerCase()}`;
    const rowErrors: string[] = [];

    if (!name) rowErrors.push("Property Name is required");
    if (!address) rowErrors.push("Address is required");
    if (!PROPERTY_TYPES.has(typeValue as Property["type"])) rowErrors.push(`Type must be one of: ${Array.from(PROPERTY_TYPES).join(", ")}`);

    ["Purchase Price", "Current Value", "Square Footage", "Monthly Rent", "Mortgage Amount", "Mortgage Payment", "Insurance Premium", "Property Tax"].forEach(header => {
      const raw = value(row, header);
      if (raw && numberValue(row, header) === undefined) rowErrors.push(`${header} must be a number`);
    });

    ["Purchase Date", "Lease Start", "Lease End", "Mortgage Renewal Date", "Insurance Renewal Date", "Property Tax Due Date"].forEach(header => {
      const raw = value(row, header);
      if (raw && optionalDate(row, header) === undefined) rowErrors.push(`${header} must be a valid date`);
    });

    if (seen.has(key)) {
      duplicates.push(`Row ${rowNumber}: ${name} at ${address} already exists`);
      return;
    }
    if (rowErrors.length > 0) {
      errors.push(`Row ${rowNumber}: ${rowErrors.join("; ")}`);
      return;
    }

    seen.add(key);
    valid.push({
      name,
      address,
      type: typeValue as Property["type"],
      purchaseDate: optionalDate(row, "Purchase Date") || new Date().toISOString().slice(0, 10),
      purchasePrice: numberValue(row, "Purchase Price") || 0,
      currentValue: numberValue(row, "Current Value"),
      squareFootage: numberValue(row, "Square Footage"),
      monthlyRent: numberValue(row, "Monthly Rent") || 0,
      tenantName: value(row, "Tenant Name") || undefined,
      tenantContact: value(row, "Tenant Contact") || undefined,
      leaseStart: optionalDate(row, "Lease Start"),
      leaseEnd: optionalDate(row, "Lease End"),
      mortgageAmount: numberValue(row, "Mortgage Amount"),
      mortgagePayment: numberValue(row, "Mortgage Payment"),
      mortgageRenewalDate: optionalDate(row, "Mortgage Renewal Date"),
      insuranceProvider: value(row, "Insurance Provider") || undefined,
      insurancePolicy: value(row, "Insurance Policy") || undefined,
      insuranceRenewalDate: optionalDate(row, "Insurance Renewal Date"),
      insurancePremium: numberValue(row, "Insurance Premium"),
      propertyTax: numberValue(row, "Property Tax"),
      propertyTaxDueDate: optionalDate(row, "Property Tax Due Date"),
      acCapacitorSize: value(row, "AC Capacitor Size") || undefined,
      acFilterSize: value(row, "AC Filter Size") || undefined,
      paintColorsInside: value(row, "Paint Colors Inside") || undefined,
      paintColorsOutside: value(row, "Paint Colors Outside") || undefined,
      waterHeaterInfo: value(row, "Water Heater Info") || undefined,
      applianceInfo: value(row, "Appliance Info") || undefined,
      notes: value(row, "Notes") || undefined,
      backgroundColor: undefined,
      customFields: [],
      imageUri: undefined,
      displayOrder: undefined,
    });
  });

  return { valid, errors, duplicates, totalRows: parsed.data.length };
};
