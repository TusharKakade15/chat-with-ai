# Privacy Policy for PRISM — Multi AI Chat

**Effective Date:** November 8, 2026  
**Last Updated:** November 8, 2026  

PRISM — Multi AI Chat ("PRISM", "we", "our", or "the extension") is a browser extension designed to provide a unified side panel interface connecting ChatGPT, Claude, and Gemini into a collaborative discussion.

We are deeply committed to protecting your privacy. This Privacy Policy details our data practices and explains how your information is handled.

---

### 1. Zero External Data Collection or Transmission
* **No Remote Servers:** PRISM does not own, operate, or communicate with any external backend servers, tracking servers, or telemetry endpoints.
* **No Analytics or Trackers:** We do not track your browsing habits, analytics, clicks, search queries, or usage metrics.
* **No Sale of Data:** We do not collect, monetize, sell, or transfer your personal data to any third parties or data brokers.

---

### 2. Local Browser Storage Only (`chrome.storage.local`)
* All discussion threads, active persona settings, and roundtable history are stored **exclusively on your local device** using the standard browser `chrome.storage.local` API.
* This data never leaves your browser and can be deleted at any time directly through the extension's "Clear All Sessions" button or by uninstalling the extension.

---

### 3. Direct Client-Side Automation (No API Keys or Credentials)
* PRISM automates the web interfaces of ChatGPT (OpenAI), Claude (Anthropic), and Gemini (Google) via client-side DOM interaction within your browser tabs.
* **No Credentials Stored:** PRISM does not ask for, capture, intercept, or store your passwords, session tokens, or login credentials. It operates solely within already authenticated tabs that you open and log into yourself.
* **Direct Communication:** Your prompts and AI responses travel solely between your browser and the respective AI service (OpenAI, Anthropic, Google) subject to their individual privacy policies.

---

### 4. Permissions Requested & Why
PRISM strictly complies with the Google Chrome Web Store **Principle of Least Privilege**:
* **`tabs`**: Used exclusively to detect, switch to, or open the relevant AI tabs (ChatGPT, Claude, Gemini) during collaborative roundtable discussions.
* **`activeTab`**: Used to interact with the active AI tab when sending prompts or reading responses.
* **`scripting`**: Used to maintain or restore connection to AI tabs if an extension reload or tab suspension occurs.
* **`storage`**: Used solely to persist your chat threads and custom persona definitions locally on your computer.
* **`sidePanel`**: Used to render the PRISM multi-agent user interface in the Chrome side panel.
* **`host_permissions` (`chatgpt.com`, `claude.ai`, `gemini.google.com`)**: Scoped strictly to the specific AI domains necessary for prompt injection and response reading.

---

### 5. Third-Party Services
When using PRISM, your interactions with ChatGPT, Claude, and Gemini are subject to the privacy terms and service agreements of their respective providers:
* [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy)
* [Anthropic Privacy Policy](https://www.anthropic.com/legal/privacy)
* [Google Privacy Policy](https://policies.google.com/privacy)

---

### 6. Contact & Open Inquiries
If you have questions, feedback, or concerns regarding this Privacy Policy or PRISM's privacy practices, please contact us or open an issue on our GitHub repository.
