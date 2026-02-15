interface Props {
  contact: {
    first_name: string;
    last_name: string;
    email: string;
    company: string | null;
    title: string | null;
  };
}

export function ContactCard({ contact }: Props) {
  return (
    <div class="contact-card">
      <strong>{contact.first_name} {contact.last_name}</strong>
      {contact.title && <span> — {contact.title}</span>}
      {contact.company && <span> @ {contact.company}</span>}
      <div class="contact-email">{contact.email}</div>
    </div>
  );
}
