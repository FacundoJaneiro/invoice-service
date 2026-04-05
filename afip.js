const Afip = require("@afipsdk/afip.js");
const fs = require("fs");

const isProduction = process.env.PRODUCTION === "true";

const config = {
  CUIT: parseInt(process.env.CUIT),
  production: isProduction,
  access_token: process.env.ACCESS_TOKEN,
};

if (isProduction && !process.env.ACCESS_TOKEN) {
  config.cert = fs.readFileSync(process.env.CERT, "utf8");
  config.key = fs.readFileSync(process.env.KEY, "utf8");
}

const afip = new Afip(config);


// Mapeo fiscal_status → tipo de comprobante AFIP
// CbteTipo: 1=Factura A, 6=Factura B
// DocTipo: 80=CUIT, 96=DNI, 99=Sin identificar
// CondicionIVAReceptorId según RG 5616:
// 1=Resp. Inscripto, 6=Monotributista, 5=Consumidor Final, 4=Exento
function resolveInvoiceType(fiscalStatus) {
  if (fiscalStatus === "RESPONSABLE_INSCRIPTO") {
    return { cbteTipo: 1, invoiceLabel: "A", docTipo: 80, discriminaIva: true, condicionIvaReceptorId: 1 };
  }
  if (fiscalStatus === "MONOTRIBUTISTA") {
    return { cbteTipo: 6, invoiceLabel: "B", docTipo: 80, discriminaIva: false, condicionIvaReceptorId: 6 };
  }
  if (fiscalStatus === "EXENTO") {
    return { cbteTipo: 6, invoiceLabel: "B", docTipo: 80, discriminaIva: false, condicionIvaReceptorId: 4 };
  }
  // CONSUMIDOR_FINAL
  return { cbteTipo: 6, invoiceLabel: "B", docTipo: 99, discriminaIva: false, condicionIvaReceptorId: 5 };
}

function todayAfip() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return parseInt(`${yyyy}${mm}${dd}`);
}

async function emitInvoice({ fiscalStatus, taxId, totalAmount, pointOfSale, concept = 1 }) {
  const { cbteTipo, invoiceLabel, docTipo, discriminaIva, condicionIvaReceptorId } =
    resolveInvoiceType(fiscalStatus);

  const lastNumber = await afip.ElectronicBilling.getLastVoucher(pointOfSale, cbteTipo);
  const nextNumber = lastNumber + 1;

  const cleanTaxId = taxId ? String(taxId).replace(/[-\s]/g, "") : null;
  const effectiveDocTipo = cleanTaxId ? docTipo : 99;
  const docNro = cleanTaxId ? parseInt(cleanTaxId) : 0;

  // Factura A: descomponer total en neto + IVA (precio ya incluye IVA)
  // Factura B: total va directo en ImpTotConc, sin discriminar
  const impNeto = discriminaIva ? parseFloat((totalAmount / 1.21).toFixed(2)) : 0;
  const impIva = discriminaIva ? parseFloat((totalAmount - totalAmount / 1.21).toFixed(2)) : 0;

  const data = {
    CantReg: 1,
    PtoVta: pointOfSale,
    CbteTipo: cbteTipo,
    Concepto: concept,
    DocTipo: effectiveDocTipo,
    DocNro: docNro,
    CbteDesde: nextNumber,
    CbteHasta: nextNumber,
    CbteFch: todayAfip(),
    ImpTotal: totalAmount,
    ImpTotConc: discriminaIva ? 0 : totalAmount,
    ImpNeto: impNeto,
    ImpOpEx: 0,
    ImpIVA: impIva,
    ImpTrib: 0,
    MonId: "PES",
    MonCotiz: 1,
    CondicionIVAReceptorId: condicionIvaReceptorId,
  };

  if (discriminaIva) {
    data.Iva = [
      {
        Id: 5, // 21%
        BaseImp: impNeto,
        Importe: impIva,
      },
    ];
  }

  console.log("Enviando a AFIP:", JSON.stringify(data));
  const response = await afip.ElectronicBilling.createVoucher(data);

  return {
    cae: response.CAE,
    caeExpiration: response.CAEFchVto,
    invoiceNumber: nextNumber,
    invoiceType: invoiceLabel,
    pointOfSale: pointOfSale,
  };
}

async function getInvoice(type, number, pointOfSale) {
  const cbteTipo = type === "A" ? 1 : 6;
  const voucher = await afip.ElectronicBilling.getVoucherInfo(number, pointOfSale, cbteTipo);
  return voucher;
}

module.exports = { emitInvoice, getInvoice };
