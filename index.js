require("dotenv").config();

const express = require("express");
const { emitInvoice, getInvoice } = require("./afip");

const app = express();
app.use(express.json());

const VALID_FISCAL_STATUSES = [
  "RESPONSABLE_INSCRIPTO",
  "MONOTRIBUTISTA",
  "CONSUMIDOR_FINAL",
  "EXENTO",
];

function validate(body) {
  const { fiscalStatus, totalAmount, pointOfSale } = body;
  if (!VALID_FISCAL_STATUSES.includes(fiscalStatus))
    return "fiscalStatus inválido";
  if (!totalAmount || totalAmount <= 0)
    return "totalAmount debe ser mayor a cero";
  if (!pointOfSale || pointOfSale <= 0)
    return "pointOfSale es obligatorio";
  if (fiscalStatus === "RESPONSABLE_INSCRIPTO" && !body.taxId)
    return "taxId (CUIT) es obligatorio para Responsable Inscripto";
  return null;
}

// POST /invoice
// Body: { saleId, fiscalStatus, taxId, totalAmount, concept? }
app.post("/invoice", async (req, res) => {
  const error = validate(req.body);
  if (error) return res.status(400).json({ error });

  const { saleId, fiscalStatus, taxId, totalAmount, pointOfSale, concept } = req.body;

  try {
    const result = await emitInvoice({ fiscalStatus, taxId, totalAmount, pointOfSale, concept });
    console.log(`[OK] Venta #${saleId} → Factura ${result.invoiceType} #${result.invoiceNumber} CAE ${result.cae}`);
    return res.status(200).json(result);
  } catch (err) {
    console.error(`[ERROR] Venta #${saleId}:`, err.message ?? err);
    console.error("Full error:", JSON.stringify(err.data ?? err.response?.data), err.stack);
    const detail = err.response?.data ?? err.message ?? String(err);
    return res.status(502).json({
      error: "Error al emitir comprobante",
      detail,
    });
  }
});

// GET /invoice/:type/:number — consulta un comprobante emitido
// type: A o B, number: número de factura
// GET /invoice/:type/:number?pointOfSale=300
app.get("/invoice/:type/:number", async (req, res) => {
  const { type, number } = req.params;
  const pointOfSale = req.query.pointOfSale ? parseInt(req.query.pointOfSale) : undefined;
  try {
    const result = await getInvoice(type.toUpperCase(), parseInt(number), pointOfSale);
    return res.status(200).json(result);
  } catch (err) {
    return res.status(502).json({ error: "Error al consultar comprobante", detail: err.message ?? String(err) });
  }
});

// GET /health
app.get("/health", (_req, res) => res.json({ status: "ok" }));

const PORT = process.env.PORT ?? 3001;
app.listen(PORT, () => console.log(`invoice-service corriendo en :${PORT}`));
