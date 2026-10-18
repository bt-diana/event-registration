-- M10 test data (docs/ROADMAP.md step 47-48): one organizer, five events on
-- 20-24 October 2026, eight attendees and their registrations. Demo logins:
-- organizer@seed.test and attendee1@seed.test .. attendee8@seed.test, all with
-- the password "demo1234". The addresses are placeholders: no real mailbox
-- behind them, and no outbox rows are written, so nothing is ever sent.
-- Event times are written in UTC+06:00. Event 2 is full with two people on
-- the waiting list.

INSERT INTO organizers (email, name, password_hash) VALUES
  ('organizer@seed.test', 'Seed Organizer', 'scrypt$5227293c16d542ef7d82cc84c69cf025$c37baaace14192515efd9f64fd251f4ae5ff04b732d60516f37cb5b8906df53d367afdb75ac6ca98bc9f3702fe5ab6270128c6ad79f5f5a78bd102de7f922ad2');

INSERT INTO users (email, name, password_hash) VALUES
  ('attendee1@seed.test', 'Alice Johnson', 'scrypt$5227293c16d542ef7d82cc84c69cf025$c37baaace14192515efd9f64fd251f4ae5ff04b732d60516f37cb5b8906df53d367afdb75ac6ca98bc9f3702fe5ab6270128c6ad79f5f5a78bd102de7f922ad2'),
  ('attendee2@seed.test', 'Bob Smith', 'scrypt$5227293c16d542ef7d82cc84c69cf025$c37baaace14192515efd9f64fd251f4ae5ff04b732d60516f37cb5b8906df53d367afdb75ac6ca98bc9f3702fe5ab6270128c6ad79f5f5a78bd102de7f922ad2'),
  ('attendee3@seed.test', 'Carol White', 'scrypt$5227293c16d542ef7d82cc84c69cf025$c37baaace14192515efd9f64fd251f4ae5ff04b732d60516f37cb5b8906df53d367afdb75ac6ca98bc9f3702fe5ab6270128c6ad79f5f5a78bd102de7f922ad2'),
  ('attendee4@seed.test', 'David Brown', 'scrypt$5227293c16d542ef7d82cc84c69cf025$c37baaace14192515efd9f64fd251f4ae5ff04b732d60516f37cb5b8906df53d367afdb75ac6ca98bc9f3702fe5ab6270128c6ad79f5f5a78bd102de7f922ad2'),
  ('attendee5@seed.test', 'Eva Green', 'scrypt$5227293c16d542ef7d82cc84c69cf025$c37baaace14192515efd9f64fd251f4ae5ff04b732d60516f37cb5b8906df53d367afdb75ac6ca98bc9f3702fe5ab6270128c6ad79f5f5a78bd102de7f922ad2'),
  ('attendee6@seed.test', 'Frank Miller', 'scrypt$5227293c16d542ef7d82cc84c69cf025$c37baaace14192515efd9f64fd251f4ae5ff04b732d60516f37cb5b8906df53d367afdb75ac6ca98bc9f3702fe5ab6270128c6ad79f5f5a78bd102de7f922ad2'),
  ('attendee7@seed.test', 'Grace Lee', 'scrypt$5227293c16d542ef7d82cc84c69cf025$c37baaace14192515efd9f64fd251f4ae5ff04b732d60516f37cb5b8906df53d367afdb75ac6ca98bc9f3702fe5ab6270128c6ad79f5f5a78bd102de7f922ad2'),
  ('attendee8@seed.test', 'Henry Clark', 'scrypt$5227293c16d542ef7d82cc84c69cf025$c37baaace14192515efd9f64fd251f4ae5ff04b732d60516f37cb5b8906df53d367afdb75ac6ca98bc9f3702fe5ab6270128c6ad79f5f5a78bd102de7f922ad2');

INSERT INTO events (organizer_id, title, description, starts_at, duration_minutes, capacity)
SELECT o.id, v.title, v.description, v.starts_at::timestamptz, v.duration_minutes, v.capacity
FROM organizers o,
  (VALUES
    ('Morning Yoga in the Park', 'Open-air yoga for all levels. Bring a mat and water.', '2026-10-20 10:00+06', 60, 20),
    ('TypeScript Workshop', 'Hands-on intro to TypeScript. Laptop required. Small group, so the seats go fast.', '2026-10-21 18:00+06', 120, 3),
    ('Lunch and Learn: Databases', 'A short talk on PostgreSQL indexes, with lunch.', '2026-10-22 12:00+06', 60, 30),
    ('Board Game Night', 'Bring a favourite game or try one of ours.', '2026-10-23 19:00+06', 180, 8),
    ('Photography Walk', 'A walk through the old town with a camera or a phone.', '2026-10-24 15:00+06', 90, 5)
  ) AS v(title, description, starts_at, duration_minutes, capacity)
WHERE o.email = 'organizer@seed.test';

INSERT INTO registrations (event_id, user_id, status, ticket_code)
SELECT e.id, u.id, v.status, v.ticket_code
FROM (VALUES
  ('Morning Yoga in the Park', 'attendee1@seed.test', 'registered', '9THM543XGF'),
  ('Morning Yoga in the Park', 'attendee2@seed.test', 'registered', 'HVNBYYFBGP'),
  ('Morning Yoga in the Park', 'attendee3@seed.test', 'registered', '8YQGVC2S9V'),
  ('Morning Yoga in the Park', 'attendee4@seed.test', 'registered', 'YW4TGWHNWZ'),
  ('TypeScript Workshop', 'attendee1@seed.test', 'registered', 'EWZFE2N3T3'),
  ('TypeScript Workshop', 'attendee2@seed.test', 'registered', '2LVUY6N5Z3'),
  ('TypeScript Workshop', 'attendee3@seed.test', 'registered', 'RWW3MV2MKM'),
  ('TypeScript Workshop', 'attendee4@seed.test', 'waitlisted', 'BA8Q22VYEW'),
  ('TypeScript Workshop', 'attendee5@seed.test', 'waitlisted', '57S66A3FDR'),
  ('Lunch and Learn: Databases', 'attendee5@seed.test', 'registered', 'JDFFGQ6KQE'),
  ('Lunch and Learn: Databases', 'attendee6@seed.test', 'registered', '8UX28G3KUD'),
  ('Board Game Night', 'attendee2@seed.test', 'registered', 'LA9JN2JWDV'),
  ('Board Game Night', 'attendee3@seed.test', 'registered', 'AKG52Q8UF3'),
  ('Board Game Night', 'attendee6@seed.test', 'registered', 'SUJ9XF9MX5'),
  ('Board Game Night', 'attendee7@seed.test', 'registered', '69XKGAP7BU'),
  ('Board Game Night', 'attendee8@seed.test', 'registered', 'CE6JUW6AN8'),
  ('Photography Walk', 'attendee1@seed.test', 'registered', 'S2K6XEE5BU'),
  ('Photography Walk', 'attendee7@seed.test', 'registered', '67CXVNCA7E'),
  ('Photography Walk', 'attendee8@seed.test', 'registered', '6HD72DBQJN')
) AS v(title, email, status, ticket_code)
JOIN events e ON e.title = v.title
JOIN users u ON u.email = v.email;
