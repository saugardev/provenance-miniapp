import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms and Conditions | Prove Reality",
  description: "Terms for using Prove Reality during the ETHGlobal hackathon.",
};

export default function TermsPage() {
  return (
    <main className="page">
      <section className="card">
        <h1>Terms and Conditions</h1>
        <p className="muted">Effective date: April 4, 2026</p>
        <p className="hint">
          These terms apply to the Prove Reality mini app demo built for ETHGlobal. By using the app, you agree to
          these terms.
        </p>

        <h2>1. Demo Purpose</h2>
        <p className="hint">
          This product is an experimental hackathon demo. It is provided as-is and may change, pause, or be removed at
          any time.
        </p>

        <h2>2. Your Consent to Upload and Store Photos</h2>
        <p className="hint">
          By uploading an image and submitting it through this app, you give us permission to:
        </p>
        <ul className="hint">
          <li>store your uploaded image and its cryptographic hash,</li>
          <li>process it to verify human-authenticity signals,</li>
          <li>use it for hackathon judging, product testing, debugging, and demo presentation.</li>
        </ul>
i 
        <h2>3. What You Confirm</h2>
        <p className="hint">You confirm that:</p>
        <ul className="hint">
          <li>you have the right to upload the image,</li>
          <li>the upload does not violate anyone else&apos;s rights,</li>
          <li>you will not upload unlawful, abusive, or harmful content.</li>
        </ul>

        <h2>4. Privacy and Retention</h2>
        <p className="hint">
          We may store uploaded photos and related verification metadata during and after the hackathon to run and
          improve this demo. Do not upload sensitive personal images. If you want your data removed, contact the team
          and we will make a reasonable effort to delete it.
        </p>

        <h2>5. No Warranty and Limitation</h2>
        <p className="hint">
          The app is provided without warranties of any kind. To the fullest extent allowed by law, we are not liable
          for losses or damages arising from use of this demo.
        </p>

        <h2>6. Updates to Terms</h2>
        <p className="hint">
          We may update these terms at any time by posting a new version on this page. Continued use means you accept
          the updated terms.
        </p>

        <p className="hint">
          <Link href="/">Back to home</Link>
        </p>
      </section>
    </main>
  );
}
