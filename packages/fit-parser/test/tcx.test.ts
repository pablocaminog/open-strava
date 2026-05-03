import { describe, expect, it } from 'vitest';
import { parseTcx } from '../src/xml/tcx.js';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase
  xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"
  xmlns:tpx="http://www.garmin.com/xmlschemas/ActivityExtension/v2">
  <Activities>
    <Activity Sport="Biking">
      <Id>2026-05-03T07:00:00Z</Id>
      <Lap StartTime="2026-05-03T07:00:00Z">
        <TotalTimeSeconds>2</TotalTimeSeconds>
        <DistanceMeters>20</DistanceMeters>
        <MaximumSpeed>10.5</MaximumSpeed>
        <Calories>5</Calories>
        <AverageHeartRateBpm><Value>121</Value></AverageHeartRateBpm>
        <MaximumHeartRateBpm><Value>130</Value></MaximumHeartRateBpm>
        <Track>
          <Trackpoint>
            <Time>2026-05-03T07:00:00Z</Time>
            <Position>
              <LatitudeDegrees>40.7</LatitudeDegrees>
              <LongitudeDegrees>-74.0</LongitudeDegrees>
            </Position>
            <AltitudeMeters>10</AltitudeMeters>
            <DistanceMeters>0</DistanceMeters>
            <HeartRateBpm><Value>120</Value></HeartRateBpm>
            <Cadence>80</Cadence>
            <Extensions>
              <TPX>
                <Watts>200</Watts>
                <Speed>9.5</Speed>
              </TPX>
            </Extensions>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-05-03T07:00:01Z</Time>
            <Position>
              <LatitudeDegrees>40.7001</LatitudeDegrees>
              <LongitudeDegrees>-74.0001</LongitudeDegrees>
            </Position>
            <AltitudeMeters>11</AltitudeMeters>
            <DistanceMeters>10</DistanceMeters>
            <HeartRateBpm><Value>125</Value></HeartRateBpm>
            <Cadence>82</Cadence>
            <Extensions>
              <TPX>
                <Watts>210</Watts>
                <Speed>10.0</Speed>
              </TPX>
            </Extensions>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

describe('parseTcx', () => {
  it('parses laps and trackpoints', () => {
    const ar = parseTcx(SAMPLE);
    expect(ar.source).toBe('tcx');
    expect(ar.session.sport).toBe('cycling');
    expect(ar.laps).toHaveLength(1);
    expect(ar.laps[0]).toMatchObject({
      totalSeconds: 2,
      totalDistance: 20,
      avgHr: 121,
      maxHr: 130,
      maxSpeed: 10.5,
    });
    expect(ar.samples).toHaveLength(2);
    expect(ar.samples[0]).toMatchObject({
      t: 0,
      lat: 40.7,
      lng: -74,
      altitude: 10,
      distance: 0,
      hr: 120,
      cadence: 80,
      power: 200,
      speed: 9.5,
    });
    expect(ar.samples[1]?.power).toBe(210);
    expect(ar.session.totalSeconds).toBe(1);
  });

  it('throws on non-TCX input', () => {
    expect(() => parseTcx('<not-tcx/>')).toThrow();
  });

  it('throws when activities missing', () => {
    expect(() => parseTcx('<TrainingCenterDatabase></TrainingCenterDatabase>')).toThrow();
  });
});
