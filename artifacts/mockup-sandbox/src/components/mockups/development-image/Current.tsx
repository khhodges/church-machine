import "./_group.css";
import html from "./_reference.html?raw";
import inputs from "./_saved-inputs.json";
export default function Current(){
  const escape = (value: unknown) => String(value ?? "—").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]!));
  const table = '<table class="ba-table"><thead><tr><th>Slot</th><th>Name</th><th>Type</th><th>Location</th><th>Policy</th></tr></thead><tbody>' +
    inputs.Original.abstractions.map(row => '<tr>' + [row.slot,row.name,row.type,row.location,("load_policy" in row ? row.load_policy : "—")].map(v => `<td>${escape(v)}</td>`).join('') + '</tr>').join('') + '</tbody></table>';
  const reference = html.replace(/<div class="ba-loading">Select the[\s\S]*?<\/div>/, table);
  return <main className="current-reference"><p>Preserved source extraction · controls are inert · saved Original slots · no hardware connection</p><div inert dangerouslySetInnerHTML={{__html:reference}} /></main>;
}
