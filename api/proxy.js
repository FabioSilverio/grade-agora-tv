import { handleProxy } from '../server/proxy-core.js'

export function GET(request) {
  return handleProxy(request)
}

export function HEAD(request) {
  return handleProxy(request)
}

export function OPTIONS(request) {
  return handleProxy(request)
}
