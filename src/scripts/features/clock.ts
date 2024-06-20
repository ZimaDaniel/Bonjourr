import { getLang, tradThis } from '../utils/translations'
import { displayInterface } from '../index'
import { eventDebounce } from '../utils/debounce'
import { SYNC_DEFAULT } from '../defaults'
import errorMessage from '../utils/errormessage'
import storage from '../storage'

type ClockUpdate = {
	ampm?: boolean
	analog?: boolean
	seconds?: boolean
	dateformat?: string
	greeting?: string
	timezone?: string
	shape?: string
	face?: string
	hands?: string
	size?: number
	border?: { opacity?: number; shade?: 'light' | 'dark' }
	background?: { opacity?: number; shade?: 'light' | 'dark' }
}

type DateFormat = Sync.Storage['dateformat']

const defaultAnalogStyle: Sync.AnalogStyle = {
	face: 'none',
	hands: 'modern',
	shape: 'round',
	border: { alpha: 1, rgb: '255, 255, 255' },
	background: { alpha: 0.2, rgb: '255, 255, 255' },
}

const oneInFive = Math.random() > 0.8 ? 1 : 0
let numberWidths = [1]
let clockInterval: number

export default function clock(init?: Sync.Storage, event?: ClockUpdate) {
	if (event) {
		clockUpdate(event)
		return
	}

	const clock = init?.clock ?? { ...SYNC_DEFAULT.clock }

	try {
		startClock(clock, init?.greeting || '', init?.dateformat || 'eu')
		clockDate(zonedDate(clock.timezone), init?.dateformat || 'eu')
		greetings(zonedDate(clock.timezone), init?.greeting || '')
		analogStyle(init?.analogstyle)
		clockSize(clock.size)
		displayInterface('clock')
	} catch (e) {
		errorMessage(e)
	}
}

//
//	Update
//

async function clockUpdate({ ampm, analog, seconds, dateformat, greeting, timezone, size, ...update }: ClockUpdate) {
	const data = await storage.sync.get(['clock', 'dateformat', 'greeting', 'analogstyle'])
	const analogstyle = data.analogstyle ?? structuredClone(defaultAnalogStyle)
	let clock = data?.clock

	if (!clock || data.dateformat === undefined || data.greeting === undefined) {
		return
	}

	if (analog !== undefined) {
		document.getElementById('analog_options')?.classList.toggle('shown', analog)
		document.getElementById('digital_options')?.classList.toggle('shown', !analog)
	}

	if (isDateFormat(dateformat)) {
		clockDate(zonedDate(clock.timezone), dateformat)
		storage.sync.set({ dateformat })
	}

	if (greeting !== undefined) {
		greetings(zonedDate(clock.timezone), greeting)
		storage.sync.set({ greeting })
	}

	if (timezone !== undefined) {
		clockDate(zonedDate(timezone), data.dateformat)
		greetings(zonedDate(timezone), data.greeting)
	}

	clock = {
		...clock,
		ampm: ampm ?? clock.ampm,
		size: size ?? clock.size,
		analog: analog ?? clock.analog,
		seconds: seconds ?? clock.seconds,
		timezone: timezone ?? clock.timezone,
	}

	// const option = update.background ? 'background' : 'border'

	if (update.background?.opacity !== undefined) {
		analogstyle.background.alpha = update.background?.opacity
		eventDebounce({ analogstyle })
		analogStyle(analogstyle)
		return
	}

	if (update.border?.opacity !== undefined) {
		analogstyle.border.alpha = update.border?.opacity
		eventDebounce({ analogstyle })
		analogStyle(analogstyle)
		return
	}

	if (update.background?.shade) {
		const rgb = update.background?.shade === 'light' ? '0, 0, 0' : '255, 255, 255'
		toggleShadeButtons('background')
		analogstyle.background.rgb = rgb
		storage.sync.set({ analogstyle })
		analogStyle(analogstyle)
		return
	}

	if (update.border?.shade) {
		const rgb = update.border?.shade === 'light' ? '0, 0, 0' : '255, 255, 255'
		toggleShadeButtons('border')
		analogstyle.border.rgb = rgb
		storage.sync.set({ analogstyle })
		analogStyle(analogstyle)
		return
	}

	if (isHands(update.hands)) analogstyle.hands = update.hands
	if (isShape(update.shape)) analogstyle.shape = update.shape
	if (isFace(update.face)) analogstyle.face = update.face

	storage.sync.set({ clock })
	storage.sync.set({ analogstyle })
	startClock(clock, data.greeting, data.dateformat)
	analogStyle(analogstyle)
	clockSize(clock.size)
}

function analogStyle(style?: Sync.AnalogStyle) {
	style = style ?? structuredClone(defaultAnalogStyle)
	const { face, shape, hands } = style

	const analog = document.getElementById('analog') as HTMLElement
	const spans = document.querySelectorAll<HTMLSpanElement>('#analog span')

	const isWhiteOpaque = style.background?.rgb?.includes('255, 255, 255') && (style?.background?.alpha ?? 10) > 0.5
	const isTransparent = style.background?.alpha === 0

	let faceNumbers = ['12', '3', '6', '9']
	const lang = getLang()

	if (lang === 'am') faceNumbers = ['Գ', 'Զ', 'Թ', 'ԺԲ']
	else if (lang === 'ar') faceNumbers = ['٣', '٦', '٩', '١٢']
	else if (lang === 'fa') faceNumbers = ['۳', '۶', '۹', '۱۲']
	else if (lang.match(/zh_CN|zh_HK|jp/)) faceNumbers = ['三', '六', '九', '十二']

	spans.forEach((span, i) => {
		if (face === 'roman') span.textContent = ['XII', 'III', 'VI', 'IX'][i]
		else if (face === 'marks') span.textContent = ['│', '―', '│', '―'][i]
		else if (face === 'number') span.textContent = faceNumbers[i]
		else span.textContent = ''
	})

	analog.dataset.face = face === 'swiss' || face === 'braun' ? face : ''
	analog.dataset.shape = shape || ''
	analog.dataset.hands = hands || ''

	analog.classList.toggle('transparent', isTransparent)
	analog.classList.toggle('white-opaque', isWhiteOpaque)

	analog.style.setProperty('--analog-border', `rgba(${style.border.rgb}, ${style.border.alpha})`)
	analog.style.setProperty('--analog-background', `rgba(${style.background.rgb}, ${style.background.alpha})`)
}

function clockSize(size = 1) {
	document.documentElement.style.setProperty('--clock-size', size.toString() + 'em')
}

function toggleShadeButtons(option: 'background' | 'border') {
	const button = document.querySelector<HTMLButtonElement>(`#i_clock${option}-shade`)
	button?.classList.toggle('shade-light')
	button?.classList.toggle('shade-dark')
}

//
//	Clock
//

function startClock(clock: Sync.Clock, greeting: string, dateformat: DateFormat) {
	document.getElementById('time')?.classList.toggle('analog', clock.analog)
	document.getElementById('time')?.classList.toggle('seconds', clock.seconds)

	if (clock.seconds) {
		setSecondsWidthInCh()
	}

	clearInterval(clockInterval)
	start()

	clockInterval = setInterval(start, 1000)

	function start() {
		const date = zonedDate(clock.timezone)
		const isNextHour = date.getMinutes() === 0

		if (clock.analog) {
			analog(date, clock.seconds)
		} else {
			digital(date, clock.ampm, clock.seconds)
		}

		if (isNextHour) {
			clockDate(date, dateformat)
			greetings(date, greeting)
		}
	}
}

function digital(date: Date, ampm: boolean, seconds: boolean) {
	const domclock = document.getElementById('digital')
	const hh = document.getElementById('digital-hh') as HTMLElement
	const mm = document.getElementById('digital-mm') as HTMLElement
	const ss = document.getElementById('digital-ss') as HTMLElement

	const m = fixunits(date.getMinutes())
	const s = fixunits(date.getSeconds())
	let h = ampm ? date.getHours() % 12 : date.getHours()

	if (ampm && h === 0) {
		h = 12
	}

	if (seconds) {
		// Avoid layout shifts by rounding width
		const second = date.getSeconds() < 10 ? 0 : Math.floor(date.getSeconds() / 10)
		const width = getSecondsWidthInCh(second)
		const offset = (-2 + width).toFixed(1)

		domclock?.style.setProperty('--seconds-width', `${width}ch`)
		domclock?.style.setProperty('--seconds-margin-offset', `${offset}ch`)
	}

	domclock?.classList.toggle('zero', !ampm && h < 10)

	hh.textContent = h.toString()
	mm.textContent = m.toString()
	ss.textContent = s.toString()
}

function analog(date: Date, seconds: boolean) {
	const m = ((date.getMinutes() + date.getSeconds() / 60) * 6).toFixed(1)
	const h = (((date.getHours() % 12) + date.getMinutes() / 60) * 30).toFixed(1)
	const s = (date.getSeconds() * 6).toFixed(1)

	document.getElementById('analog-hours')?.style.setProperty('--deg', `${h}deg`)
	document.getElementById('analog-minutes')?.style.setProperty('--deg', `${m}deg`)

	if (!seconds) {
		return
	}

	document.getElementById('analog-seconds')?.style.setProperty('--deg', `${s}deg`)
}

//
//	Date
//

// prettier-ignore
const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function clockDate(date: Date, dateformat: DateFormat) {
	const datedom = document.getElementById('date') as HTMLElement
	const aa = document.getElementById('date-aa') as HTMLElement
	const bb = document.getElementById('date-bb') as HTMLElement
	const cc = document.getElementById('date-cc') as HTMLElement

	const lang = getLang()
	const useSinograms = lang.includes('zh') || lang.includes('jp')
	const day = date.getDate().toString() + (useSinograms ? '日' : '')
	const weekday = tradThis(days[date.getDay()])
	const month = tradThis(months[date.getMonth()])

	datedom.classList.remove('eu', 'us', 'cn')
	datedom.classList.add(dateformat)

	if (dateformat === 'eu') {
		aa.textContent = weekday
		bb.textContent = day
		cc.textContent = month
	}

	if (dateformat === 'us') {
		aa.textContent = weekday
		bb.textContent = month
		cc.textContent = day
	}

	if (dateformat === 'cn') {
		aa.textContent = month
		bb.textContent = day
		cc.textContent = weekday
	}
}

//
//	Greetings
//

function greetings(date: Date, name?: string) {
	const domgreetings = document.getElementById('greetings') as HTMLTitleElement
	const domgreeting = document.getElementById('greeting') as HTMLSpanElement
	const domname = document.getElementById('greeting-name') as HTMLSpanElement

	const rare = oneInFive
	const hour = date.getHours()
	let period: 'night' | 'morning' | 'afternoon' | 'evening'

	if (hour < 3) period = 'evening'
	else if (hour < 5) period = 'night'
	else if (hour < 12) period = 'morning'
	else if (hour < 18) period = 'afternoon'
	else period = 'evening'

	const greetings = {
		morning: 'Good morning',
		afternoon: 'Good afternoon',
		evening: 'Good evening',
		night: ['Good night', 'Sweet dreams'][rare],
	}

	const greet = greetings[period]

	domgreetings.style.textTransform = name || (rare && period === 'night') ? 'none' : 'capitalize'
	domgreeting.textContent = tradThis(greet) + (name ? ', ' : '')
	domname.textContent = name ?? ''
}

// Helpers

function setSecondsWidthInCh() {
	const span = document.getElementById('digital-number-width')!
	const zero = span.offsetWidth
	numberWidths = [1]

	for (let i = 1; i < 6; i++) {
		span.textContent = i.toString()
		numberWidths.push(Math.round((span.offsetWidth / zero) * 10) / 10)
	}
}

function getSecondsWidthInCh(second: number): number {
	return Math.min(...numberWidths) + numberWidths[second]
}

function zonedDate(timezone: string = 'auto') {
	const date = new Date()

	if (timezone === 'auto') {
		return date
	}

	const offset = date.getTimezoneOffset() / 60 // hour
	let utcHour = date.getHours() + offset
	const utcMinutes = date.getMinutes() + date.getTimezoneOffset()
	let minutes

	if (timezone.split('.')[1]) {
		minutes = utcMinutes + parseInt(timezone.split('.')[1])

		if (minutes > -30) {
			utcHour++
		}
	} else {
		minutes = date.getMinutes()
	}

	date.setHours(utcHour + parseInt(timezone), minutes)

	return date
}

function createHexColorFromSettings(option: 'background' | 'border'): string {
	const domopacity = document.querySelector<HTMLInputElement>(`#i_clock${option}-opacity`)
	const domshade = document.querySelector<HTMLButtonElement>(`#i_clock${option}-shade`)

	const opacity = parseInt(domopacity?.value ?? '0')
	const shade = domshade?.classList.contains('shade-light') ? 'light' : 'dark'
	const color = shade === 'dark' ? '#000' : '#fff'
	const alpha = opacity.toString(16)

	return color + alpha
}

function fixunits(val: number) {
	return (val < 10 ? '0' : '') + val.toString()
}

function isFace(str?: string): str is Sync.AnalogStyle['face'] {
	return ['none', 'number', 'roman', 'marks', 'swiss', 'braun'].includes(str ?? '')
}

function isHands(str?: string): str is Sync.AnalogStyle['hands'] {
	return ['modern', 'swiss-hands', 'classic', 'braun', 'apple'].includes(str ?? '')
}

function isShape(str?: string): str is Sync.AnalogStyle['shape'] {
	return ['round', 'square', 'rectangle'].includes(str ?? '')
}

// function isBorder(str = ''): str is Sync.Clock['border'] {
// 	return ['white', 'black', 'none'].includes(str)
// }

// function isBackground(str = ''): str is Sync.Clock['background'] {
// 	return ['light', 'dark', 'white', 'black', 'none'].includes(str)
// }

function isDateFormat(str = ''): str is DateFormat {
	return ['eu', 'us', 'cn'].includes(str)
}
