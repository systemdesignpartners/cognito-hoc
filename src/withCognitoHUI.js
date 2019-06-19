import React from 'react';
import PropTypes from 'prop-types';
import Amplify, { Auth, Hub } from 'aws-amplify';
import { withOAuth } from 'aws-amplify-react';
import ReactLoadingOverlay from 'react-loading-overlay';
import { AuthStorageIDB } from '@systemdesignpartners/cognito-auth-storage';


const withCognitoHUI = (WrappedComponent = null, inAmplifyConfig = null, inMode = 'button', inDelay = 1500) => {
  // Make sure we can configure Amplify
  if (!inAmplifyConfig) {
    const errMsg = "Must supply an Amplify config file (e.g. 'awsmobile', 'awsconfig', aka aws-exports.js. Exiting.";
    throw new Error(errMsg);
  }
  let amplifyConfig = Object.assign({}, inAmplifyConfig);

  // Non-React property for the Timer. Need a ref so we can clearTimout() as needed
  let _hubTimer = null;
  // helper variable to track our actual times
  let _hubTimerMs = 0;

  class HOC extends React.Component {
    constructor(props) {
      super(props);
      this.signOut = this.signOut.bind(this);

      let shouldDelay = true;
      let initialAuthStorageInfo = 'the cognito default storage';

      // The amplifyConfig must be good. A mistaken (non-null) parameter here will produce
      // weird errors.

      if (amplifyConfig.storage && amplifyConfig.storage.storageType() === 'AuthStorageIDB') {
        AuthStorageIDB.init(
          (errmsg) => {
            delete amplifyConfig.storage;
            // Since we are in a callback, must setState instead of using value of "shouldDelay"
            this.setState({ delayRenderForAuthStorage: false });
            Amplify.configure(amplifyConfig);
          },
          async (myNewStorage) => {
            // init must complete all of its work and invoke this callback only
            // when it is fully complete (all promises awaited and resolved)

            amplifyConfig.storage = myNewStorage;

            // Since we are in a callback, must setState instead of using value of "shouldDelay"
            this.setState({ authStorageInfo: 'AuthStorageIDB' });

            // Here we are relying on init to have fully completed all its work
            Amplify.configure(amplifyConfig);

            // Check the current user when the App component is loaded
            await Auth.currentAuthenticatedUser({ bypassCache: true }).then((user) => {
              const { authState } = this.state;
              // if (authState === 'signedIn') We can skip setting authState to 'signedIn' because it already is.
              //   Probably this was a manual page reload by the user
              if (authState !== 'signedIn') {
                this.setState({ authState: 'signedIn' });
              }
            }).catch((e) => {
              // Note that even AFTER a successful sign in, IF it is from a Federated entity,
              // we will STILL hit this error - because the Federated sign in is a different page,
              // and this page will go through its constructor before Hub has a chance to hear
              // its 'signIn' event ('signIn' for Hub means "somebody just signedIn").
              this.setState({ authState: 'mustSignIn' });
            });

            this.setState({ delayRenderForAuthStorage: false });
          },
        );
      } else if (amplifyConfig.storage && amplifyConfig.storage.storageType() === 'AuthStorageMemory') {
        shouldDelay = false;
        initialAuthStorageInfo = 'AuthStorageMemory'; // state is not ready yet, so don't use setState
        Amplify.configure(amplifyConfig);
      } else {
        delete amplifyConfig.storage;
        shouldDelay = false;
        Amplify.configure(amplifyConfig);
      }


      // let the Hub module listen on Auth events
      Hub.listen('auth', (data) => {
        switch (data.payload.event) {
          case 'signIn':
            this.setState({ authState: 'signedIn' });
            this.setState({ authData: data.payload.data });
            break;
          case 'signIn_failure':
            this.setState({ authState: 'mustSignIn' });
            this.setState({ authData: null });
            this.setState({ authError: data.payload.data });
            break;
          case 'signUp':
            break;
          case 'signOut':
            break;
          case 'configured':
            this.setState({ authState: 'mustSignIn' });
            this.setState({ authData: null });
            this.setState({ authError: data.payload.data });
            break;
          case 'cognitoHostedUI':
            break;
          case 'cognitoHostedUI_failure':
            break;
          default:
            break;
        }
      });

      this.state = {
        delayRenderForAuthStorage: shouldDelay,
        authStorageInfo: initialAuthStorageInfo,
        authState: 'loading',
        authData: null,
        authError: null,
      };


      // pseudo-class-constants

      this.loadingOverlay = (
        <ReactLoadingOverlay
          active
          spinner
          text="Loading"
          styles={{
            wrapper: () => ({
              width: '100%',
              height: '100%',
            }),
            overlay: base => ({
              ...base,
              background: 'white',
              color: '#228b22',
            }),
            spinner: base => ({
              ...base,
              width: '100px',
              '& svg circle': {
                stroke: '#228b22',
              },
            }),
          }}
        />
      );

      this.trulyLoadingDiv = <div className="cognitoHocLoading">{this.loadingOverlay}</div>;


      // If we are ready to login, go to the Hosted UI (if mode === 'timer'), or display the
      // Sign In button (if mode === 'button').
      // If mode === 'button' this is where we would display the unprotected content
      let whichLoginConfig;
      if (inMode === 'timer') {
        whichLoginConfig = <div className="cognitoHocLoading">{this.loadingOverlay}</div>;
      } else { // proceed on the basis of the default === 'button'
        whichLoginConfig = <div className="cognitoHocLogin">{this.signInButton()}</div>;
      }
      this.headedToLoginDiv = whichLoginConfig;
    }


    componentDidMount() {
      const { delayRenderForAuthStorage } = this.state;

      if (delayRenderForAuthStorage) {
        return;
      }

      // check the current user when the App component is loaded
      Auth.currentAuthenticatedUser().then((user) => {
        const { authState } = this.state;
        // if (authState === 'signedIn') We can skip setting authState to 'signedIn' because it already is.
        //  Probably this was a manual page reload by the user
        if (authState !== 'signedIn') {
          this.setState({ authState: 'signedIn' });
        }
      }).catch((e) => {
        // Note that even AFTER a successful sign in, IF it is from a Federated entity,
        // we will STILL hit this error - because the Federated sign in is a different page,
        // and this page will go through its constructor before Hub has a chance to hear
        // its 'signIn' event ('signIn' for Hub means "somebody just signedIn").
        this.setState({ authState: 'mustSignIn' });
      });
    }


    componentDidUpdate(prevProps, prevState) {
      const { OAuthSignIn } = this.props;
      const { authState, delayRenderForAuthStorage } = this.state;

      if (delayRenderForAuthStorage) {
        return;
      }

      if (inMode === 'button') {
        return;
      }

      // We monitor changes to authState so that we can automatically push the User to the Login
      // screen when needed, rather than forcing them to stop at a splash page and hit a button to
      // continue.
      //
      // There are several interesting transitions:
      // loading -> signedIn:
      //   This happens for instance when a User starts the App, but was already logged in
      //   previously (e.g. as indicated by localStorage). There is nothing we need to do.
      // signedIn -> mustSignIn:
      //   This happens when a User logs out. We would then prefer to push the User back to the
      //   Login screen however it is pointless to do so, because this Component (App) will be
      //   reloaded anyway. So we will soon see a loading -> mustSignIn transition no matter what
      //   action we take.
      // loading -> mustSignIn:
      //   This is the important case. There are two ways we can see this. The first is when the
      //   User starts the App cleanly. Our constructor will set 'loading,' and the
      //   componentDidMount will Error on currentAuthenticatedUser, and therefore set 'mustSignIn.'
      //   This is the case where we want to push the User to the Login screen ASAP. However we
      //   cannot, because unfortunately there is the second case where we can see this same
      //   transition. This occurs immediately after the User does log in (expect it to occur
      //   whether it is a Social login or a direct Cognito User Pool login). In such case, our
      //   constructor will again be invoked, setting 'loading,' and componentDidMount will again
      //   Error on currentAuthenticatedUser (presumably the setup of localStorage is not complete
      //   yet), setting 'mustSignIn,' and finally, Hub will hear its 'signIn' signal, and set
      //   authState to 'signedIn'. Therefore, upon every transition from loading -> mustSignIn, we
      //   should set a Timer. If it times out, we can automatically push the User to the Login
      //   page. But if a transition to signedIn occurs, we should abandon this Timer and NOT push
      //   the User to the Login page yet again (which would cause a disastrous looping condition
      //   and an App that could never be accessed).

      const myMs = Date.now();

      // If our authState went from loading => mustSignIn, we must proceed with the Timer.
      // Or, if we are using an async storage, we might have missed the loading => mustSignIn signal
      // because we were still at delayRenderForAuthStorage === true. So also proceed if authState
      // is sitting at "mustSignIn" and delayRenderForAuthStorage went from true to false.

      if ((authState === 'mustSignIn' && prevState.authState === 'loading')
         || (authState === 'mustSignIn' && prevState.authState === 'mustSignIn'
             && !delayRenderForAuthStorage && prevState.delayRenderForAuthStorage)
      ) {
        this.setHubTimerMs(myMs);
        const myTimer = setTimeout(() => {
          const myNewMs = Date.now();
          const jumpingTime = myNewMs - this.hubTimerMs();
          // FYI - Set the inDelay very low to test this.
          this.setHubTimer(null);
          this.setHubTimerMs(0);
          OAuthSignIn(); // a prop of the withOAuth HOC
        }, inDelay);
        this.setHubTimer(myTimer);
      } else if (authState === 'signedIn' && prevState.authState === 'mustSignIn') {
        if (this.hubTimer()) {
          const clearingTime = myMs - this.hubTimerMs();
          clearTimeout(this.hubTimer());
          this.setHubTimer(null);
          this.setHubTimerMs(0);
        }
      }
    }


    componentWillUnmount() {
      if (this.hubTimer()) {
        clearTimeout(this.hubTimer());
        this.setHubTimer(null);
        this.setHubTimerMs(0);
      }
    }

    setHubTimer(inTimer) {
      _hubTimer = inTimer;
    }


    setHubTimerMs(inHubTimerMs) {
      _hubTimerMs = inHubTimerMs;
    }


    hubTimer() {
      return _hubTimer;
    }


    hubTimerMs() {
      return _hubTimerMs;
    }


    signOut() {
      Auth.signOut().then(() => {
        this.setState({ authState: 'mustSignIn' });
      }).catch((e) => {
        console.log(`Error on signout! signOut() error is: ${e}`);
      });
    }


    signInButton() {
      const { OAuthSignIn } = this.props;
      return (<button type="button" className="cognitoHocSignInButton" onClick={() => OAuthSignIn()}>Sign In</button>);
    }


    signOutButton() { return (<button type="button" className="cognitoHocSignOutButton" onClick={() => this.signOut()}>Sign Out</button>); }


    render() {
      const { OAuthSignIn, ...wrappedComponentProps } = this.props;
      const { authStorageInfo, authState, delayRenderForAuthStorage } = this.state;

      if (delayRenderForAuthStorage) {
        // Display "loading" because we are waiting on the Amplify.auth.storage to be set up.
        // Until this happens, we cannot Authorize and so we do not know what to display.
        return (<div>{this.trulyLoadingDiv}</div>);
      }
      // Display depending on authState and whether we have an OAuthSignIn yet.
      // We only send authStorageInfo so our WrappedComponent can display it. In real life you likely
      // would have no use for this.
      return (
        <div>
          {((authState === 'loading') || (authState !== 'signedIn' && !OAuthSignIn)) && this.trulyLoadingDiv}
          {authState !== 'signedIn' && OAuthSignIn && this.headedToLoginDiv}
          {authState === 'signedIn' && (
          <div className="cognitoHocWrapper">
            {this.signOutButton()}
            <WrappedComponent authStorageInfo={authStorageInfo} {...wrappedComponentProps} />
          </div>
          )}
        </div>
      );
    }
  }


  HOC.propTypes = {
    OAuthSignIn: PropTypes.func.isRequired,
  };

  // Return this HOC wrapped inside the withOAuth HOC, so we can leverage its OAuthSignIn prop
  // exactly as it usually would be
  return withOAuth(HOC);
};


export default withCognitoHUI;
