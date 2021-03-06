import { Injectable, Inject } from '@angular/core';
import { Observable,Subject } from 'rxjs/Rx';
import { Http,Headers,RequestOptions } from "@angular/http";

@Injectable()
export class ReconnectingWebSocket {
    //These can be altered by calling code
    public debug:boolean = false;

    //Time to wait before attempting reconnect (after close)
    public reconnectInterval:number = 1000;
    //Time to wait for WebSocket to open (before aborting and retrying)
    public timeoutInterval:number = 2000;

    //Should only be used to read WebSocket readyState
    public readyState:number;
    public readyStateSubject:Subject<number> = new Subject<number>();

    //Whether WebSocket was forced to close by this client
    private forcedClose:boolean = false;
    //Whether WebSocket opening timed out
    private timedOut:boolean = false;

    //List of WebSocket sub-protocols
    private protocols:string[] = [];

    //The underlying WebSocket
    private ws:WebSocket;
    private url:string;

    /**
     * Setting this to true is the equivalent of setting all instances of ReconnectingWebSocket.debug to true.
     */
    public static debugAll = false;

    //Set up the default 'noop' event handlers
    public onopen:(ev:Event) => void = function (event:Event) {};
    public onclose:(ev:CloseEvent) => void = function (event:CloseEvent) {};
    public onconnecting:() => void = function () {};
    public onmessage:(ev:MessageEvent) => void = function (event:MessageEvent) {};
    public onerror:(ev:ErrorEvent) => void = function (event:ErrorEvent) {};

    public checkCredentials() {
        let headers = new Headers();
        headers.append('Content-Type', 'application/x-www-form-urlencoded');
        let options = new RequestOptions({
            headers: headers,
            withCredentials: true
        });
        let username = window.localStorage.getItem("username");
        let password = window.localStorage.getItem("password");
        return this.$http.post("https://manage.interactify.io/authcheck","username="+username+"&password="+password,options);        
    }

    public login() {
        let headers = new Headers();
        headers.append('Content-Type', 'application/x-www-form-urlencoded');
        let options = new RequestOptions({
            headers: headers,
            withCredentials: true
        });
        let username = window.localStorage.getItem("username");
        let password = window.localStorage.getItem("password");
        return this.$http.post("https://manage.interactify.io/login?stop_success_redirect=1","username="+username+"&password="+password,options);
    }    

    constructor(private $http: Http) {
        this.readyState = WebSocket.CONNECTING;
        this.readyStateSubject.next(this.readyState);
    }

    public statusFormatted(status: number) {
        let mapping = {};
        mapping[WebSocket.CLOSED] = 'Offline';
        mapping[WebSocket.CONNECTING] = 'Connecting..';
        mapping[WebSocket.OPEN] = 'Online';
        return mapping[status];
    }

    public connect(url:string, reconnectAttempt:boolean, protocols:string[] = []) {
        let self = this;
        this.readyState = WebSocket.CLOSED;
        this.readyStateSubject.next(this.readyState);
        this.login().subscribe( () => {
            this.url = url;
            this.protocols = protocols;
            WebSocket['pluginOptions'] = {
                origin: 'https://',
                maxConnectTime: 5000,
                override: true
            };
            this.ws = new WebSocket(this.url, this.protocols);
            this.readyState = WebSocket.CONNECTING;
            this.readyStateSubject.next(this.readyState);
            this.onconnecting();
            this.log('ReconnectingWebSocket', 'attempt-connect', this.url);

            var localWs = this.ws;
            var timeout = setTimeout(() => {
                this.log('ReconnectingWebSocket', 'connection-timeout', this.url);
                this.timedOut = true;
                localWs.close();
                this.timedOut = false;
            }, this.timeoutInterval);

            this.ws.onopen = (event:Event) => {
                clearTimeout(timeout);
                this.log('ReconnectingWebSocket', 'onopen', this.url);
                this.readyState = WebSocket.OPEN;
                this.readyStateSubject.next(this.readyState);
                reconnectAttempt = false;
                this.onopen(event);
            };

            this.ws.onclose = (event:CloseEvent) => {
                clearTimeout(timeout);
                this.ws = null;
                if (this.forcedClose) {
                    this.readyState = WebSocket.CLOSED;
                    this.readyStateSubject.next(this.readyState);
                    this.onclose(event);
                } else {
                    if (!reconnectAttempt && !this.timedOut) {
                        this.log('ReconnectingWebSocket', 'onclose', this.url);
                        this.onclose(event);
                    }
                    setTimeout(() => {
                        this.connect(url, reconnectAttempt, protocols);
                    }, this.reconnectInterval);
                }
            };
            this.ws.onmessage = (event) => {
                this.log('ReconnectingWebSocket', 'onmessage', this.url, event.data);
                this.onmessage(event);
            };
            this.ws.onerror = (event) => {
                this.log('ReconnectingWebSocket', 'onerror', this.url, event);
                this.onerror(event);
            };
        }, err => {
            setTimeout(() => {
                self.connect(url, reconnectAttempt, protocols);
            }, self.reconnectInterval);
        });
    }

    public send(data:any) {
        if (this.ws) {
            this.log('ReconnectingWebSocket', 'send', this.url, data);
            return this.ws.send(data);
        } else {
            throw 'INVALID_STATE_ERR : Pausing to reconnect websocket';
        }
    }

    /**
     * Returns boolean, whether websocket was FORCEFULLY closed.
     */
    public close():boolean {
        if (this.ws) {
            this.forcedClose = true;
            this.ws.close();
            return true;
        }
        return false;
    }

    /**
     * Additional public API method to refresh the connection if still open (close, re-open).
     * For example, if the app suspects bad data / missed heart beats, it can try to refresh.
     *
     * Returns boolean, whether websocket was closed.
     */
    public refresh():boolean {
        if (this.ws) {
            this.ws.close();
            return true;
        }
        return false;
    }

    private log(...args: any[]) {
        if (this.debug || ReconnectingWebSocket.debugAll) {
            console.debug.apply(console, args);
        }
    }
}
