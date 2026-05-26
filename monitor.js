import nodemailer from "nodemailer";
import { chromium } from "playwright";

const URL = "https://cita.consuladoperumadrid.org/qmaticwebbooking/#";
const UNAVAILABLE_TEXT = "The appointment booking is currently not available";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function sendEmail({ subject, text }) {
  const smtpUser = requiredEnv("SMTP_USER");
  const smtpPass = requiredEnv("SMTP_PASS");
  const notifyTo = requiredEnv("NOTIFY_TO");

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: String(process.env.SMTP_PORT || "465") === "465",
    auth: {
      user: smtpUser,
      pass: smtpPass
    }
  });

  await transporter.sendMail({
    from: process.env.MAIL_FROM || smtpUser,
    to: notifyTo,
    subject,
    text
  });
}

async function checkAvailability() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

  try {
    await page.goto(URL, { waitUntil: "networkidle", timeout: 45000 });
  } catch {
    await page.waitForTimeout(7000);
  }

  const state = await page.evaluate((unavailableText) => {
    const bodyText = document.body?.innerText || "";
    const buttons = Array.from(
      document.querySelectorAll("button, input[type='button'], input[type='submit'], a")
    ).map((el) => {
      const label = (el.innerText || el.value || "").trim();
      const styles = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const visible = Boolean(
        rect.width &&
          rect.height &&
          styles.display !== "none" &&
          styles.visibility !== "hidden" &&
          Number(styles.opacity) !== 0
      );

      return {
        text: label,
        visible
      };
    });

    const visibleReload = buttons.some(
      (button) => button.visible && button.text.toUpperCase() === "RELOAD"
    );

    const hasBookingFlow =
      /Reserva de cita|SELECCIONAR SERVICIO|SELECCIONAR FECHA Y HORA|Elija uno o varios servicios/i.test(
        bodyText
      );

    return {
      title: document.title,
      url: location.href,
      hasUnavailableText: bodyText.includes(unavailableText),
      visibleReload,
      hasBookingFlow,
      bodySample: bodyText.slice(0, 700)
    };
  }, UNAVAILABLE_TEXT);

  await browser.close();
  return state;
}

const checkedAt = new Date();
const state = await checkAvailability();

console.log(JSON.stringify({ checkedAt: checkedAt.toISOString(), ...state }, null, 2));
if (state.hasUnavailableText || state.visibleReload || !state.hasBookingFlow) {
  console.log("No notification sent: appointment booking is not clearly available.");
  process.exit(0);
}

const madridTime = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "full",
  timeStyle: "medium",
  timeZone: "Europe/Madrid"
}).format(checkedAt);

await sendEmail({
  subject: "Citas posiblemente disponibles - Consulado Peru Madrid",
  text: [
    "Las citas del Consulado de Peru en Madrid parecen estar disponibles.",
    "",
    `Fecha/hora de comprobacion: ${madridTime}`,
    `URL: ${URL}`,
    "",
    "Senales detectadas:",
    `- Titulo: ${state.title}`,
    `- Flujo de reserva visible: ${state.hasBookingFlow ? "si" : "no"}`,
    `- Mensaje de no disponibilidad: ${state.hasUnavailableText ? "si" : "no"}`,
    `- Boton Reload visible: ${state.visibleReload ? "si" : "no"}`,
    "",
    "Abre la pagina cuanto antes para intentar reservar."
  ].join("\n")
});

console.log("Notification sent.");

if (state.hasUnavailableText || state.visibleReload || !state.hasBookingFlow) {
  console.log("No notification sent: appointment booking is not clearly available.");
  process.exit(0);
}
