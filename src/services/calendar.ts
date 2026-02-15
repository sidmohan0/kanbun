import { google } from "googleapis";

export class CalendarService {
  private calendar;

  constructor(credentials: {
    client_id: string;
    client_secret: string;
    access_token: string;
    refresh_token: string;
  }) {
    const auth = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret
    );
    auth.setCredentials({
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token,
    });
    this.calendar = google.calendar({ version: "v3", auth });
  }

  async createEvent(params: {
    summary: string;
    description?: string;
    startTime: string;
    endTime: string;
    attendeeEmail?: string;
  }): Promise<string> {
    const event = await this.calendar.events.insert({
      calendarId: "primary",
      requestBody: {
        summary: params.summary,
        description: params.description,
        start: { dateTime: params.startTime },
        end: { dateTime: params.endTime },
        attendees: params.attendeeEmail
          ? [{ email: params.attendeeEmail }]
          : undefined,
      },
    });
    return event.data.id ?? "";
  }

  async listUpcoming(maxResults: number = 10) {
    const res = await this.calendar.events.list({
      calendarId: "primary",
      timeMin: new Date().toISOString(),
      maxResults,
      singleEvents: true,
      orderBy: "startTime",
    });
    return res.data.items ?? [];
  }
}
