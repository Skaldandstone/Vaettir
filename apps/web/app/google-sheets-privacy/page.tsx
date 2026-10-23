import { GoogleSheetsPrivacyNotice } from "../../components/GoogleSheetsPrivacyNotice";

export const metadata = {
  title: "Google Sheets import privacy | Vaettir",
  description: "How Vaettir reads selected Google worksheets, protects the temporary connection, and handles imported records.",
};

export default function GoogleSheetsPrivacyPage() {
  return <GoogleSheetsPrivacyNotice />;
}
