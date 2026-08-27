import { NextRequest, NextResponse } from 'next/server.js';
import { todayInEastern } from '../../../../lib/dates.ts';
import { getTvSettings } from '../../../../lib/tv-service.ts';
import {
  listLatePlates,
  mealWindow,
  currentKitchenMeal,
  MEALS,
} from '../../../../lib/late-plate-service.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
  'Cache-Control': 'no-cache, no-store, must-revalidate',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: NextRequest) {
  try {
    const config = await getTvSettings();
    const settings = config.latePlates || {};

    if (!settings.enabled) {
      return NextResponse.json(
        { success: false, disabled: true, reason: 'Panel is switched off' },
        { headers: CORS_HEADERS }
      );
    }

    const date = todayInEastern();
    
    // Call internal services directly, no auth required because this is meant
    // for the local TV display to render names only.
    const everything = await listLatePlates(date, { includeClosed: false });
    
    const meals: Record<string, any> = {};
    for (const meal of MEALS) {
      const window = await mealWindow(date, meal);
      const forMeal = everything.filter((p) => p.meal === meal);
      const count = (status: string) => forMeal.filter((p) => p.status === status).length;
      
      meals[meal] = {
        cutoff: window.open ? 'Open' : 'Closed', // Simplify for TV if needed, or pass exact
        closed: window.closedReason !== null,
        served: window.served,
        open: window.open,
        toMake: count('waiting'),
        ready: count('ready')
      };
    }

    const body = {
      success: true,
      date,
      currentMeal: currentKitchenMeal(),
      meals,
      // The TV only expects 'name', 'meal', 'status' (no dietary notes!)
      plates: everything
        .filter((p) => p.status === 'waiting' || p.status === 'ready')
        .map((p) => ({ name: p.name, meal: p.meal, status: p.status }))
    };

    return NextResponse.json(body, { headers: CORS_HEADERS });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Failed to load late plates for TV' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
