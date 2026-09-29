import sys, re
from icalendar import Calendar
for path in sys.argv[1:]:
    raw = open(path, 'rb').read()
    lines = raw.split(b'\r\n')
    assert raw.endswith(b'\r\n'), 'must end with CRLF'
    assert b'\n' not in raw.replace(b'\r\n', b''), 'bare LF found'
    assert all(len(l) <= 75 for l in lines), 'line > 75 octets'
    cal = Calendar.from_ical(raw)
    assert cal['VERSION'] == '2.0' and 'PRODID' in cal
    tz = [c for c in cal.walk('VTIMEZONE')]
    ev = cal.walk('VEVENT')[0]
    for k in ('UID', 'DTSTAMP', 'DTSTART', 'SUMMARY'):
        assert k in ev, k + ' missing'
    alarms = ev.walk('VALARM')
    for a in alarms:
        assert a['ACTION'] == 'DISPLAY' and 'TRIGGER' in a and 'DESCRIPTION' in a
    print(f"OK {path}: SUMMARY={ev['SUMMARY']} DTSTART={ev['DTSTART'].dt!r} TZ={[t['TZID'] for t in tz]} alarms={[str(a['TRIGGER'].dt) for a in alarms]}")
