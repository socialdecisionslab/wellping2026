import { PINGS, PINGS_DICT } from "./data/pings";

beforeAll(() => {
  /** TEST TEST DATA INTEGRITY **/
  (() => {
    let lastPingTime = new Date(0);
    PINGS.forEach((ping) => {
      expect(ping.notificationTime < ping.startTime).toBeTruthy();
      if (ping.endTime !== null) {
        expect(ping.startTime < ping.endTime).toBeTruthy();
      }

      expect(ping.notificationTime > lastPingTime).toBeTruthy();
      lastPingTime = ping.notificationTime;
    });

    expect(PINGS).toHaveLength(Object.keys(PINGS_DICT).length);
  })();
});

afterAll(() => {});

// All deterministic scheduling fixtures use UTC.
beforeAll(() => {
  expect(new Date().getTimezoneOffset()).toBe(0);
});
