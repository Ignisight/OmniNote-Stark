/**
 * Google Drive Service for OmniNote
 * Handles OAuth2 and File Operations
 */

const CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com'; // User needs to replace this
const API_KEY = 'YOUR_API_KEY'; // User needs to replace this
const DISCOVERY_DOCS = ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"];
const SCOPES = "https://www.googleapis.com/auth/drive.file";

export class DriveService {
  private static instance: DriveService;
  private gapi: any;

  private constructor() {}

  static getInstance() {
    if (!this.instance) {
      this.instance = new DriveService();
    }
    return this.instance;
  }

  async initGapi(callback: (isSignedIn: boolean) => void) {
    // Load the GAPI script dynamically
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.onload = () => {
      (window as any).gapi.load("client:auth2", async () => {
        await (window as any).gapi.client.init({
          apiKey: API_KEY,
          clientId: CLIENT_ID,
          discoveryDocs: DISCOVERY_DOCS,
          scope: SCOPES,
        });

        const authInstance = (window as any).gapi.auth2.getAuthInstance();
        authInstance.isSignedIn.listen(callback);
        callback(authInstance.isSignedIn.get());
      });
    };
    document.body.appendChild(script);
  }

  async signIn() {
    return (window as any).gapi.auth2.getAuthInstance().signIn();
  }

  async signOut() {
    return (window as any).gapi.auth2.getAuthInstance().signOut();
  }

  async saveNote(note: { id: string; title: string; content: string }) {
    const fileContent = JSON.stringify(note);
    const file = new Blob([fileContent], { type: 'application/json' });
    
    // Logic to check if file exists and update, or create new
    // Simplified: Always create for now or find by name
    const metadata = {
      'name': `omninote_${note.id}.json`,
      'mimeType': 'application/json'
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    try {
      const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: new Headers({ 'Authorization': 'Bearer ' + (window as any).gapi.auth.getToken().access_token }),
        body: form
      });
      return await response.json();
    } catch (error) {
      console.error("Drive upload error:", error);
    }
  }

  /**
   * Upload an image paste to Drive
   */
  async uploadImage(blob: Blob, filename: string) {
    const metadata = {
      'name': filename,
      'mimeType': blob.type
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob);

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: new Headers({ 'Authorization': 'Bearer ' + (window as any).gapi.auth.getToken().access_token }),
      body: form
    });
    const file = await response.json();
    return file.id; // Return the Drive File ID
  }
}
