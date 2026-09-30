import { describe, expect, it } from 'vitest';
import { joinedNews, vetoNews } from './session-news.ts';

const ME = 1;
const alex = { id: ME, name: 'Alex' };
const jo = { id: 2, name: 'Jo' };
const sam = { id: 3, name: 'Sam' };
const kim = { id: 4, name: 'Kim' };
const people = [alex, jo, sam, kim];
const row = (placeId: number, name: string, vetoedBy: number[] = []) => ({ placeId, name, vetoedBy });

describe('#54: who joined', () => {
  it('#54 AC1: someone new since the last check', () => expect(joinedNews([alex, jo], [alex, jo, sam], ME)).toEqual(['Sam joined']));
  it('#54 AC2: nobody on opening the session, and never yourself', () => {
    expect(joinedNews(null, [alex, jo, sam], ME)).toEqual([]);
    expect(joinedNews([jo], [jo, alex], ME)).toEqual([]);
  });
  it('#54 AC3: two people joining between checks are two toasts', () => expect(joinedNews([alex], [alex, jo, sam], ME)).toEqual(['Jo joined', 'Sam joined']));
});

describe('#54: what was ruled out or brought back', () => {
  it('#54 AC4: someone else ruling a place out', () => {
    expect(vetoNews([row(10, 'Pretend Diner')], [row(10, 'Pretend Diner', [jo.id])], people, ME)).toEqual(['Jo ruled out Pretend Diner']);
  });
  it('#54 AC5: someone else bringing a place back', () => {
    expect(vetoNews([row(10, 'Pretend Diner', [jo.id, sam.id])], [row(10, 'Pretend Diner', [sam.id])], people, ME)).toEqual(['Jo brought Pretend Diner back']);
  });
  it('#54 AC6: nothing for what was already out on opening, nor for your own vetoes', () => {
    expect(vetoNews(null, [row(10, 'Pretend Diner', [jo.id])], people, ME)).toEqual([]);
    expect(vetoNews([row(10, 'Pretend Diner')], [row(10, 'Pretend Diner', [ME])], people, ME)).toEqual([]);
    expect(vetoNews([row(10, 'Pretend Diner', [ME])], [row(10, 'Pretend Diner')], people, ME)).toEqual([]);
  });
  it('several changes at once each get a toast; places that disappear are not "brought back"', () => {
    const before = [row(10, 'Pretend Diner'), row(11, 'Invented Bar', [kim.id]), row(12, 'Gone Cafe', [sam.id])];
    const after = [row(10, 'Pretend Diner', [jo.id, sam.id]), row(11, 'Invented Bar')];
    expect(vetoNews(before, after, people, ME)).toEqual(['Jo ruled out Pretend Diner', 'Sam ruled out Pretend Diner', 'Kim brought Invented Bar back']);
  });
});
