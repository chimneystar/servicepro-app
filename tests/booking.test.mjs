import test from "node:test";
import assert from "node:assert/strict";
import { addMinutes, buildBookingSlots, matchesServiceArea, normalizePhone } from "../lib/booking.ts";

const hours={"1":["08:00","17:00"],"2":["08:00","17:00"],"3":["08:00","17:00"],"4":["08:00","17:00"],"5":["08:00","17:00"],"6":null,"7":null};

test("booking slots respect business hours and service duration",()=>{const slots=buildBookingSlots({date:"2026-08-03",hours,intervalMin:60,durationMin:90,arrivalWindowMin:120,minNoticeHours:0,maxDaysAhead:90,capacity:1,busy:[],now:new Date("2026-08-01T08:00:00")});assert.equal(slots[0].start,"08:00");assert.equal(slots.at(-1).start,"15:00");assert.equal(slots[0].label,"08:00–10:00");});

test("a full-capacity overlap removes the slot",()=>{const slots=buildBookingSlots({date:"2026-08-03",hours,intervalMin:60,durationMin:60,arrivalWindowMin:60,minNoticeHours:0,maxDaysAhead:90,capacity:1,busy:[{start:"09:00",end:"10:00"}],now:new Date("2026-08-01T08:00:00")});assert.equal(slots.some((slot)=>slot.start==="09:00"),false);assert.equal(slots.some((slot)=>slot.start==="10:00"),true);});

test("team capacity keeps a slot until every technician is busy",()=>{const slots=buildBookingSlots({date:"2026-08-03",hours,intervalMin:60,durationMin:60,arrivalWindowMin:60,minNoticeHours:0,maxDaysAhead:90,capacity:2,busy:[{start:"09:00",end:"10:00"}],now:new Date("2026-08-01T08:00:00")});assert.equal(slots.some((slot)=>slot.start==="09:00"),true);});

test("service areas match ZIP or city",()=>{const areas=[{area_type:"zip",values_json:["78701","78702"],active:true},{area_type:"city",values_json:["Lakeway"],active:true}];assert.equal(matchesServiceArea("78701","Austin",areas),true);assert.equal(matchesServiceArea("00000","lakeway",areas),true);assert.equal(matchesServiceArea("00000","Dallas",areas),false);});

test("booking helpers normalize common values",()=>{assert.equal(normalizePhone("+1 (512) 555-0199"),"5125550199");assert.equal(addMinutes("09:30",90),"11:00");});
